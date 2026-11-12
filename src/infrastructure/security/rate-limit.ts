import { log } from "../observability/logger.js";

/**
 * Limitação de taxa por IP e por endpoint, sobre o binding "Rate Limiting" do Cloudflare Workers.
 * Os limites (requisições por 60 s) ficam no `wrangler.toml`, um binding por endpoint.
 *
 * Modos (`RATE_LIMIT_MODE`):
 * - `off` (padrão se ausente): não consulta nada.
 * - `log`: consulta e registra `rate_limit.would_block`, mas NUNCA bloqueia (homologação).
 * - `enforce`: responde 429 quando o limite é excedido.
 * Qualquer falha do binding libera a requisição (fail-open): proteção contra abuso não pode derrubar o site.
 * O IP nunca é registrado em log.
 */
export type RateLimitMode = "off" | "log" | "enforce";

export const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

export function readRateLimitMode(env: { RATE_LIMIT_MODE?: unknown }): RateLimitMode {
  const value = typeof env.RATE_LIMIT_MODE === "string" ? env.RATE_LIMIT_MODE.trim().toLowerCase() : "";
  return value === "log" || value === "enforce" ? value : "off";
}

export interface RateLimitCheck {
  binding: RateLimit | undefined;
  /** Nome estável do endpoint: compõe a chave do contador e aparece no log. */
  endpoint: string;
  mode: RateLimitMode;
  /** IP do cliente (`CF-Connecting-IP`); sem ele não há chave confiável e a requisição passa. */
  ip: string | undefined;
}

/** `true` quando a requisição deve ser recusada com 429. */
export async function shouldBlock({ binding, endpoint, mode, ip }: RateLimitCheck): Promise<boolean> {
  if (mode === "off") return false;
  if (!binding) {
    log("warn", "rate_limit.binding_missing", { endpoint, mode });
    return false;
  }
  if (!ip) return false;
  try {
    // A chave inclui o endpoint: rotas que compartilham um binding (ex.: as três da newsletter em
    // RL_NEWSLETTER) têm contadores independentes.
    const { success } = await binding.limit({ key: `${endpoint}:${ip}` });
    if (success) return false;
    log("warn", mode === "enforce" ? "rate_limit.blocked" : "rate_limit.would_block", { endpoint, mode });
    return mode === "enforce";
  } catch (err) {
    log("warn", "rate_limit.check_failed", { endpoint, reason: err instanceof Error ? err.name : "unknown" });
    return false;
  }
}
