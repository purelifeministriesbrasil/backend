// Regras puras do comando `set-status` da caixa pastoral (sem acesso a banco nem a process.env,
// para poderem ser testadas). Devem espelhar os CHECKs triage_status_chk e contact_status_chk.

/** Status que a CLI pode definir manualmente. `purged` fica de fora: só o expurgo o define. */
export const SETTABLE_STATUSES = Object.freeze({
  triage: Object.freeze(["received", "in_review", "contacted", "closed"]),
  contact: Object.freeze(["received", "answered", "closed"]),
});

export const MIN_REASON_LENGTH = 5;

/**
 * Extrai e valida os argumentos de `set-status <código> <status> --reason "motivo"`.
 * Retorna `{ ok: true, code, status, reason }` ou `{ ok: false, message }`.
 */
export function parseSetStatusArgs(args) {
  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx === -1 ? undefined : args[reasonIdx + 1];
  const positional = args.filter((_, i) => i !== reasonIdx && i !== reasonIdx + 1);
  const [code, status, ...extra] = positional;

  if (!code || !status || extra.length > 0) {
    return { ok: false, message: 'Uso: set-status <código> <status> --reason "motivo da alteração".' };
  }
  if (typeof reason !== "string" || reason.trim().length < MIN_REASON_LENGTH || reason.startsWith("--")) {
    return { ok: false, message: `--reason é obrigatório (mín. ${MIN_REASON_LENGTH} caracteres).` };
  }
  return { ok: true, code, status, reason: reason.trim() };
}

/** Valida o novo status para o tipo de registro ("triage" | "contact") e o status atual. */
export function validateStatusChange(kind, currentStatus, newStatus) {
  const allowed = SETTABLE_STATUSES[kind];
  if (!allowed) return { ok: false, message: `Tipo de registro desconhecido: ${kind}.` };
  if (newStatus === "purged") {
    return { ok: false, message: "O status 'purged' só é definido pelo expurgo automático, nunca pela CLI." };
  }
  if (!allowed.includes(newStatus)) {
    return { ok: false, message: `Status inválido para ${kind}. Permitidos: ${allowed.join(", ")}.` };
  }
  if (currentStatus === "purged") {
    return { ok: false, message: "Registro já expurgado; não pode ser alterado." };
  }
  if (currentStatus === newStatus) {
    return { ok: false, message: `O registro já está com status '${newStatus}'.` };
  }
  return { ok: true };
}
