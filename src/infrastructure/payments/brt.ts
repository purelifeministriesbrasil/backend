// Horário de Brasília (UTC-03:00, sem horário de verão desde 2019) — usado nos contratos dos gateways.
const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;

function shifted(date: Date): Date {
  return new Date(date.getTime() + BRT_OFFSET_MS);
}

/** "YYYY-MM-DD" no fuso de Brasília. */
export function brtDate(date: Date): string {
  return shifted(date).toISOString().slice(0, 10);
}

/** "YYYY-MM-DDTHH:mm:ss.SSS-03:00" (formato de `date_of_expiration` do Mercado Pago). */
export function brtTimestamp(date: Date): string {
  return `${shifted(date).toISOString().slice(0, 23)}-03:00`;
}

/** Interpreta "YYYY-MM-DD HH:mm:ss" (sem fuso, padrão Asaas) como horário de Brasília. */
export function parseBrtLocal(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value.replace(" ", "T")}-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
