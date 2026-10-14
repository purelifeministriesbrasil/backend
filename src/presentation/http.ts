import type { z } from "zod";
import { assertBodySize } from "../infrastructure/security/request-guards.js";

export const NO_STORE = { "Content-Type": "application/json", "Cache-Control": "no-store" } as const;

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: NO_STORE });
}

export interface TurnstileVerifier {
  /** Secret já vinculado na composição; recebe o token e o IP do cliente. */
  verify(token: string, ip?: string): Promise<boolean>;
}

export function clientIp(request: Request): string | undefined {
  return request.headers.get("CF-Connecting-IP") ?? undefined;
}

export const turnstileFailed = () =>
  json(403, { error: "turnstile_failed", message: "Verificação de segurança falhou. Tente novamente." });

export const missingIdempotencyKey = () =>
  json(400, { error: "invalid_idempotency_key", message: "Cabeçalho Idempotency-Key ausente ou inválido." });

/** Lê o corpo com limite em bytes reais e faz parse JSON. Devolve `Response` pronta em caso de erro. */
export async function readJson(request: Request, maxBytes: number): Promise<{ body: unknown } | Response> {
  const raw = await request.text();
  if (!assertBodySize(raw, maxBytes)) return json(413, { error: "payload_too_large" });
  try {
    return { body: JSON.parse(raw) };
  } catch {
    return json(400, { error: "invalid_json" });
  }
}

/** 422 com mensagens por campo (sem ecoar valores enviados). */
export function validationFailed(error: z.ZodError): Response {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_";
    fields[path] ??= issue.message;
  }
  return json(422, {
    error: "validation_failed",
    message: "Alguns campos estão inválidos. Revise e tente novamente.",
    fields,
  });
}

export const serviceUnavailable = () =>
  json(503, { error: "service_unavailable", message: "Serviço temporariamente indisponível. Tente novamente em instantes." });

export const internalError = () =>
  json(500, { error: "internal_error", message: "Não foi possível concluir a solicitação. Tente novamente." });
