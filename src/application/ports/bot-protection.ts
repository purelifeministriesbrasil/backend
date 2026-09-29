/**
 * Porta de proteção anti-bot para formulários públicos (§7.3).
 * Isola a camada de aplicação de provedores específicos (e.g., Cloudflare Turnstile).
 */
export interface BotProtectionPort {
  verify(token: string, secretKey: string, ip?: string): Promise<boolean>;
}
