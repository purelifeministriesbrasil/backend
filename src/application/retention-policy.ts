// Prazos de retenção adotados pela coordenação em 21/11/2026 (ver documentation: Inventário de Retenção).
// São constantes de código de propósito: mudar um prazo exige revisão, teste e atualização da Política.

/** Dias que uma inscrição na newsletter nunca confirmada (e já sem link válido) permanece antes de ser apagada. */
export const NEWSLETTER_PENDING_RETENTION_DAYS = 7;

/** Dias após o cancelamento em que o e-mail é apagado, mantendo só o hash irreversível (lista de supressão). */
export const NEWSLETTER_UNSUBSCRIBED_RETENTION_DAYS = 30;

/** Dias de guarda da trilha de auditoria (quem leu o quê, quando e por quê). */
export const AUDIT_RETENTION_DAYS = 365;

/** Dias de guarda dos registros técnicos de webhooks de pagamento já concluídos. */
export const WEBHOOK_RETENTION_DAYS = 365;

/** Valor neutro que substitui o assunto de um contato expurgado (a coluna é NOT NULL). */
export const PURGED_CONTACT_SUBJECT = "[removido]";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Instante-limite: tudo que for anterior a `now - days` está vencido. */
export function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}
