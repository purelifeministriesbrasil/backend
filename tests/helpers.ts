import { vi } from "vitest";
import type { Env } from "../src/index.js";
import type { Notifier } from "../src/application/ports/notifier.js";

export const SITE = "https://purelifeministriesbrasil.org";

/** Chave AES/pepper aleatória por execução: nenhum segredo fixo no repositório. */
export function randomKeyB64(bytes = 32): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))));
}

export function validEnv(overrides: Partial<Env> = {}): Env {
  return {
    PUBLIC_SITE_ORIGIN: SITE,
    ENVIRONMENT: "test",
    DATABASE_URL: "postgresql://user:pass@127.0.0.1:1/unused",
    TRIAGE_KEY_V1: randomKeyB64(),
    HASH_PEPPER: randomKeyB64(),
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    RESEND_API_KEY: "re_test_key",
    EMAIL_FROM: "Pure Life <nao-responda@purelifeministriesbrasil.org>",
    STAFF_NOTIFICATION_EMAIL: "equipe@purelifeministriesbrasil.org",
    PAYMENT_PROVIDER: "asaas",
    ASAAS_API_KEY: "asaas_test_key",
    ASAAS_WEBHOOK_SECRET: "asaas_webhook_secret_test",
    ASAAS_DONATION_CUSTOMER_ID: "cus_000000000001",
    ASAAS_API_BASE_URL: "https://api-sandbox.asaas.com/v3",
    ...overrides,
  };
}

export function jsonRequest(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Request {
  return new Request(`https://api.purelifeministriesbrasil.org${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SITE, "Sec-Fetch-Site": "same-site", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

export function recordingNotifier(): Notifier & { sent: { to: string; subject: string; text: string }[] } {
  const sent: { to: string; subject: string; text: string }[] = [];
  return {
    sent,
    notifyStaff: vi.fn(async (subject: string, text: string) => {
      sent.push({ to: "staff", subject, text });
      return true;
    }),
    sendToRecipient: vi.fn(async (to: string, subject: string, text: string) => {
      sent.push({ to, subject, text });
      return true;
    }),
  };
}

export const passTurnstile = { verify: vi.fn(async () => true) };
export const failTurnstile = { verify: vi.fn(async () => false) };

export const validTriage = {
  isAdult: true,
  programInterest: "residencial",
  profile: "para_mim",
  fullName: "João da Silva",
  email: "joao@example.com",
  phone: "(61) 99999-8888",
  contactChannel: "whatsapp",
  report: "Relato confidencial",
  consent: true,
  policyVersion: "2026-09-19",
  turnstileToken: "token-turnstile-valido",
};

export const validContact = {
  fullName: "Maria Souza",
  email: "maria@example.com",
  subject: "Geral",
  message: "Gostaria de informações sobre o programa residencial.",
  consent: true,
  policyVersion: "2026-09-19",
  turnstileToken: "token-turnstile-valido",
};
