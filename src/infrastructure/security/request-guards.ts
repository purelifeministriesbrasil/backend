import { idempotencyKeySchema, IDEMPOTENCY_KEY_HEADER } from "../../schemas/index.js";

export interface GuardOptions {
  maxBytes: number;
  accept: string[];
}

export function deny(status: number, headers?: Record<string, string>): Response {
  return new Response(null, {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

/**
 * Limite estrito em BYTES reais após codificação UTF-8 (§7.4).
 * Impede que caracteres acentuados ou emojis burlem a contagem de caracteres UTF-16.
 */
export function assertBodySize(raw: string, maxBytes: number): boolean {
  return new TextEncoder().encode(raw).byteLength <= maxBytes;
}

/** Recusa cedo pelo Content-Length declarado, antes de ler o corpo para a memória. */
export function exceedsDeclaredLength(request: Request, maxBytes: number): boolean {
  const declared = request.headers.get("Content-Length");
  if (declared === null) return false;
  const length = Number(declared);
  return !Number.isFinite(length) || length < 0 || length > maxBytes;
}

export function guardRequest(
  request: Request,
  publicSiteOrigin: string,
  opts: GuardOptions
): Response | null {
  if (request.method !== "POST") {
    return deny(405, { Allow: "POST" });
  }

  const contentType = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (!opts.accept.includes(contentType)) {
    return deny(415);
  }

  if (exceedsDeclaredLength(request, opts.maxBytes)) {
    return deny(413);
  }

  const origin = request.headers.get("Origin");
  if (origin && origin !== publicSiteOrigin) {
    return deny(403);
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && !["same-origin", "same-site"].includes(fetchSite)) {
    return deny(403);
  }

  return null;
}

/** Lê e valida o header `Idempotency-Key` (UUID v4). Retorna `null` se ausente ou inválido. */
export function readIdempotencyKey(request: Request): string | null {
  const parsed = idempotencyKeySchema.safeParse(request.headers.get(IDEMPOTENCY_KEY_HEADER)?.trim());
  return parsed.success ? parsed.data.toLowerCase() : null;
}

/**
 * Converte `application/x-www-form-urlencoded` em objeto, rejeitando parâmetros repetidos
 * (HTTP Parameter Pollution): `email=a&email=b` nunca vira "último vence" silencioso.
 */
export function parseFormBody(raw: string): Record<string, string> | null {
  const params = new URLSearchParams(raw);
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    if (Object.prototype.hasOwnProperty.call(result, key)) return null;
    result[key] = value;
  }
  return result;
}
