/**
 * Contrato de ambiente do Worker e validação fail-closed por funcionalidade.
 * Workers não têm fase de boot com acesso ao env: a validação ocorre por requisição
 * e falha explicitamente (503 + log com os NOMES das chaves inválidas, nunca valores).
 */
export interface Env {
  PUBLIC_SITE_ORIGIN: string;
  ENVIRONMENT: string;

  DATABASE_URL?: string;

  /** Chaveiro AES-256 (Base64 de 32 bytes). Versões extras: TRIAGE_KEY_V2, TRIAGE_KEY_V3... */
  TRIAGE_KEY_V1?: string;
  TRIAGE_KEY_CURRENT_VERSION?: string;
  /** Pepper (Base64, >= 32 bytes) do HMAC de e-mails usados em deduplicação sem PII em claro. */
  HASH_PEPPER?: string;

  TURNSTILE_SECRET_KEY?: string;

  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  STAFF_NOTIFICATION_EMAIL?: string;

  PAYMENT_PROVIDER?: string;
  PIX_EXPIRATION_MINUTES?: string;

  ASAAS_API_KEY?: string;
  ASAAS_WEBHOOK_SECRET?: string;
  ASAAS_DONATION_CUSTOMER_ID?: string;
  ASAAS_API_BASE_URL?: string;

  MERCADOPAGO_ACCESS_TOKEN?: string;
  MERCADOPAGO_WEBHOOK_SECRET?: string;
  MERCADOPAGO_PAYER_FALLBACK_EMAIL?: string;

  [key: string]: unknown;
}

export class ConfigError extends Error {
  constructor(
    public readonly invalidKeys: string[],
    public readonly feature: string
  ) {
    super(`config_invalid:${feature}:${invalidKeys.join(",")}`);
    this.name = "ConfigError";
  }
}

const TURNSTILE_TEST_SECRET = /^[123]x0+A{2}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const ASAAS_PRODUCTION_BASE_URL = "https://api.asaas.com/v3";

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function str(env: Env, key: string): string {
  return (env[key] as string).trim();
}

export function isProduction(env: Env): boolean {
  return env.ENVIRONMENT === "production";
}

function base64ByteLength(value: string): number | null {
  if (!BASE64_RE.test(value) || value.length % 4 !== 0) return null;
  try {
    return atob(value).length;
  } catch {
    return null;
  }
}

function requireKeys(env: Env, feature: string, keys: string[]): void {
  const missing = keys.filter((k) => !nonEmpty(env[k]));
  if (missing.length > 0) throw new ConfigError(missing, feature);
}

export function readDatabaseUrl(env: Env): string {
  requireKeys(env, "database", ["DATABASE_URL"]);
  return str(env, "DATABASE_URL");
}

export interface CryptoConfig {
  keys: Record<number, string>;
  currentVersion: number;
  hashPepper: string;
}

export function readCryptoConfig(env: Env): CryptoConfig {
  requireKeys(env, "crypto", ["TRIAGE_KEY_V1", "HASH_PEPPER"]);

  const keys: Record<number, string> = {};
  const invalid: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    const match = /^TRIAGE_KEY_V(\d+)$/.exec(name);
    if (!match || !nonEmpty(value)) continue;
    if (base64ByteLength(value.trim()) !== 32) invalid.push(name);
    else keys[Number(match[1])] = value.trim();
  }

  const currentVersion = nonEmpty(env.TRIAGE_KEY_CURRENT_VERSION) ? Number(env.TRIAGE_KEY_CURRENT_VERSION) : 1;
  if (!Number.isInteger(currentVersion) || !keys[currentVersion]) invalid.push("TRIAGE_KEY_CURRENT_VERSION");

  const pepperLength = base64ByteLength(str(env, "HASH_PEPPER"));
  if (pepperLength === null || pepperLength < 32) invalid.push("HASH_PEPPER");

  if (invalid.length > 0) throw new ConfigError(invalid, "crypto");
  return { keys, currentVersion, hashPepper: str(env, "HASH_PEPPER") };
}

export function readTurnstileSecret(env: Env): string {
  requireKeys(env, "turnstile", ["TURNSTILE_SECRET_KEY"]);
  const secret = str(env, "TURNSTILE_SECRET_KEY");
  // As chaves de teste oficiais da Cloudflare aprovam qualquer token: proibidas em produção.
  if (isProduction(env) && TURNSTILE_TEST_SECRET.test(secret)) {
    throw new ConfigError(["TURNSTILE_SECRET_KEY"], "turnstile");
  }
  return secret;
}

export interface EmailConfig {
  apiKey: string;
  from: string;
  staffRecipient: string;
}

export function readEmailConfig(env: Env): EmailConfig {
  requireKeys(env, "email", ["RESEND_API_KEY", "EMAIL_FROM", "STAFF_NOTIFICATION_EMAIL"]);
  return {
    apiKey: str(env, "RESEND_API_KEY"),
    from: str(env, "EMAIL_FROM"),
    staffRecipient: str(env, "STAFF_NOTIFICATION_EMAIL"),
  };
}

export type PaymentConfig =
  | {
      provider: "asaas";
      apiKey: string;
      webhookSecret: string;
      donationCustomerId: string;
      apiBaseUrl: string;
      pixExpirationMinutes: number;
    }
  | {
      provider: "mercadopago";
      accessToken: string;
      webhookSecret: string;
      payerFallbackEmail: string;
      pixExpirationMinutes: number;
    };

export function readPaymentConfig(env: Env): PaymentConfig {
  requireKeys(env, "payments", ["PAYMENT_PROVIDER"]);
  const provider = str(env, "PAYMENT_PROVIDER").toLowerCase();

  const minutes = nonEmpty(env.PIX_EXPIRATION_MINUTES) ? Number(env.PIX_EXPIRATION_MINUTES) : 60;
  // O Mercado Pago exige expiração entre 30 minutos e 30 dias.
  if (!Number.isInteger(minutes) || minutes < 30 || minutes > 43_200) {
    throw new ConfigError(["PIX_EXPIRATION_MINUTES"], "payments");
  }

  if (provider === "asaas") {
    requireKeys(env, "payments", ["ASAAS_API_KEY", "ASAAS_WEBHOOK_SECRET", "ASAAS_DONATION_CUSTOMER_ID"]);
    const apiBaseUrl = nonEmpty(env.ASAAS_API_BASE_URL)
      ? str(env, "ASAAS_API_BASE_URL").replace(/\/+$/, "")
      : ASAAS_PRODUCTION_BASE_URL;
    if (!apiBaseUrl.startsWith("https://")) throw new ConfigError(["ASAAS_API_BASE_URL"], "payments");
    return {
      provider,
      apiKey: str(env, "ASAAS_API_KEY"),
      webhookSecret: str(env, "ASAAS_WEBHOOK_SECRET"),
      donationCustomerId: str(env, "ASAAS_DONATION_CUSTOMER_ID"),
      apiBaseUrl,
      pixExpirationMinutes: minutes,
    };
  }

  if (provider === "mercadopago") {
    requireKeys(env, "payments", [
      "MERCADOPAGO_ACCESS_TOKEN",
      "MERCADOPAGO_WEBHOOK_SECRET",
      "MERCADOPAGO_PAYER_FALLBACK_EMAIL",
    ]);
    return {
      provider,
      accessToken: str(env, "MERCADOPAGO_ACCESS_TOKEN"),
      webhookSecret: str(env, "MERCADOPAGO_WEBHOOK_SECRET"),
      payerFallbackEmail: str(env, "MERCADOPAGO_PAYER_FALLBACK_EMAIL"),
      pixExpirationMinutes: minutes,
    };
  }

  throw new ConfigError(["PAYMENT_PROVIDER"], "payments");
}
