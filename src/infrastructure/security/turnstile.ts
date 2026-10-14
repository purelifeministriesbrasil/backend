import type { BotProtectionPort } from "../../application/ports/bot-protection.js";
import { fetchWithTimeout } from "../http/fetch.js";
import { log } from "../observability/logger.js";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Valida um token Cloudflare Turnstile na API siteverify (§7.3). Fail-closed: erro de rede,
 * timeout ou resposta inesperada reprovam o token. Não há atalho para tokens "dummy": em
 * desenvolvimento use as chaves de teste oficiais da Cloudflare; testes injetam o verificador.
 */
export async function verifyTurnstileToken(token: string, secretKey: string, ip?: string): Promise<boolean> {
  if (!secretKey || !token) return false;

  const formData = new FormData();
  formData.append("secret", secretKey);
  formData.append("response", token);
  if (ip) formData.append("remoteip", ip);

  try {
    const res = await fetchWithTimeout(SITEVERIFY_URL, { method: "POST", body: formData, timeoutMs: 3_000 });
    if (!res.ok) {
      log("warn", "turnstile.siteverify_http_error", { status: res.status });
      return false;
    }
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success !== true) {
      log("info", "turnstile.rejected", { codes: data["error-codes"] ?? [] });
    }
    return data.success === true;
  } catch (err) {
    log("warn", "turnstile.siteverify_unreachable", { reason: err instanceof Error ? err.name : "unknown" });
    return false;
  }
}

/** Adaptador que implementa BotProtectionPort utilizando Cloudflare Turnstile. */
export function createTurnstileAdapter(): BotProtectionPort {
  return { verify: verifyTurnstileToken };
}
