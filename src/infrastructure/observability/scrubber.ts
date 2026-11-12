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
  "ip",
  "cpf",
  "address",
  "endereco",
  "subject",
  "assunto",
]);

/** Fragmentos que marcam a chave como sensível mesmo em nomes compostos (ex.: donorEmail, apiToken). */
const SENSITIVE_FRAGMENTS = ["email", "phone", "token", "secret", "password", "cipher", "plaintext", "apikey"];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (SENSITIVE_KEYS.has(normalized)) return true;
  const compact = normalized.replace(/[_-]/g, "");
  return SENSITIVE_FRAGMENTS.some((fragment) => compact.includes(fragment));
}

/**
 * Padrões de PII reconhecidos dentro de valores de texto (defesa em profundidade para chaves com nome
 * inocente, como `reason`). Fronteiras impedem casar trechos de UUIDs, timestamps ISO ou códigos.
 */
const VALUE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]"],
  [/(?<![\w.-])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\w-])/g, "[REDACTED_CPF]"],
  [/(?<![\w-])(?:\+?55[\s-]?)?\(?\d{2}\)?[\s-]?9?\d{4}[\s-]\d{4}(?![\w-])/g, "[REDACTED_PHONE]"],
];

function scrubString(value: string): string {
  return VALUE_PATTERNS.reduce((acc, [re, replacement]) => acc.replace(re, replacement), value);
}

export function scrubObject<T>(obj: T): T {
  if (typeof obj === "string") {
    return scrubString(obj) as unknown as T;
  }

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
    } else if ((typeof value === "object" && value !== null) || typeof value === "string") {
      sanitized[key] = scrubObject(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized as T;
}
