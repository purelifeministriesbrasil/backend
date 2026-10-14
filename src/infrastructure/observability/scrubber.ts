/**
 * Observability Scrubber (§5.1)
 * Strips PII, confession reports, phone numbers, secrets and raw payloads from logs and error tracking.
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
  "asaas-access-token",
  "x-signature",
]);

/** Fragmentos que marcam a chave como sensível mesmo em nomes compostos (ex.: donorEmail, apiToken). */
const SENSITIVE_FRAGMENTS = ["email", "phone", "token", "secret", "password", "cipher", "plaintext", "apikey"];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (SENSITIVE_KEYS.has(normalized)) return true;
  const compact = normalized.replace(/[_-]/g, "");
  return SENSITIVE_FRAGMENTS.some((fragment) => compact.includes(fragment));
}

export function scrubObject<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(scrubObject) as unknown as T;
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = scrubObject(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
}
