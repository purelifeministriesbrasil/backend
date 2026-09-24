/**
 * Observability Scrubber (§5.1)
 * Strips PII, confession reports, phone numbers, and raw payloads from error logs and Sentry.
 */
const SENSITIVE_KEYS = new Set([
  "fullname",
  "name",
  "email",
  "phone",
  "telefone",
  "report",
  "relato",
  "message",
  "mensagem",
  "pixcopypaste",
  "authorization",
  "cookie",
  "cf-access-jwt-assertion",
]);

export function scrubObject<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(scrubObject) as unknown as T;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = scrubObject(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
}
