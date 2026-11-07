import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/index.js";
import { readRateLimitMode, shouldBlock } from "../src/infrastructure/security/rate-limit.js";
import { SITE, validEnv, validTriage } from "./helpers.js";

/** Binding simulado: permite `limit` chamadas por chave e nega as seguintes. */
function fakeBinding(limit: number) {
  const hits = new Map<string, number>();
  return {
    hits,
    limit: vi.fn(async ({ key }: { key: string }) => {
      const n = (hits.get(key) ?? 0) + 1;
      hits.set(key, n);
      return { success: n <= limit };
    }),
  };
}

const API = "https://api.purelifeministriesbrasil.org";
const ip = { "CF-Connecting-IP": "203.0.113.7" };
const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SITE, "Sec-Fetch-Site": "same-site", "Idempotency-Key": crypto.randomUUID(), ...ip, ...headers },
    body: JSON.stringify(body),
  });

describe("readRateLimitMode", () => {
  it("só aceita log/enforce; qualquer outra coisa é off", () => {
    expect(readRateLimitMode({})).toBe("off");
    expect(readRateLimitMode({ RATE_LIMIT_MODE: "ENFORCE " })).toBe("enforce");
    expect(readRateLimitMode({ RATE_LIMIT_MODE: "log" })).toBe("log");
    expect(readRateLimitMode({ RATE_LIMIT_MODE: "true" })).toBe("off");
  });
});

describe("shouldBlock", () => {
  const base = { endpoint: "contato", ip: "203.0.113.7" };

  it("off não consulta o binding; log nunca bloqueia; enforce bloqueia acima do limite", async () => {
    const b = fakeBinding(1);
    expect(await shouldBlock({ ...base, binding: b, mode: "off" })).toBe(false);
    expect(b.limit).not.toHaveBeenCalled();

    expect(await shouldBlock({ ...base, binding: b, mode: "log" })).toBe(false);
    expect(await shouldBlock({ ...base, binding: b, mode: "log" })).toBe(false); // excedeu, mas só registra

    expect(await shouldBlock({ ...base, binding: b, mode: "enforce" })).toBe(true);
  });

  it("falha do binding, binding ausente ou IP ausente liberam a requisição", async () => {
    const broken = { limit: vi.fn(async () => { throw new Error("boom"); }) };
    expect(await shouldBlock({ ...base, binding: broken, mode: "enforce" })).toBe(false);
    expect(await shouldBlock({ ...base, binding: undefined, mode: "enforce" })).toBe(false);
    const b = fakeBinding(0);
    expect(await shouldBlock({ ...base, ip: undefined, binding: b, mode: "enforce" })).toBe(false);
    expect(b.limit).not.toHaveBeenCalled();
  });
});

describe("rate limiting no roteador", () => {
  const app = createApp({ verifyTurnstile: async () => true });
  const contact = { name: "Maria", email: "m@example.com", subject: "Geral", message: "Olá, gostaria de conversar.", policyVersion: "2026-09-19", consent: true, turnstileToken: "token-turnstile-valido" };

  it("enforce: devolve 429 com Retry-After depois do limite e não chega ao handler", async () => {
    const RL_TRIAGE = fakeBinding(2);
    const env = validEnv({ RATE_LIMIT_MODE: "enforce", RL_TRIAGE });
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 3; i++) {
      last = await app.fetch(postJson("/api/forms/triagem", { ...validTriage, turnstileToken: "token-turnstile-valido" }), env);
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 2)).not.toContain(429);
    expect(statuses[2]).toBe(429);
    expect(last?.headers.get("Retry-After")).toBe("60");
    expect(((await last!.json()) as { error: string }).error).toBe("rate_limited");
  });

  it("log: nunca devolve 429, mesmo acima do limite", async () => {
    const RL_CONTACT = fakeBinding(0);
    const env = validEnv({ RATE_LIMIT_MODE: "log", RL_CONTACT });
    const res = await app.fetch(postJson("/api/forms/contato", contact), env);
    expect(res.status).not.toBe(429);
    expect(RL_CONTACT.limit).toHaveBeenCalledTimes(1);
  });

  it("sem RATE_LIMIT_MODE o recurso fica desligado", async () => {
    const RL_CONTACT = fakeBinding(0);
    const res = await app.fetch(postJson("/api/forms/contato", contact), validEnv({ RL_CONTACT }));
    expect(res.status).not.toBe(429);
    expect(RL_CONTACT.limit).not.toHaveBeenCalled();
  });

  it("limita cada endpoint com seu binding e a chave é o IP", async () => {
    const RL_NEWSLETTER = fakeBinding(0);
    const RL_DONATION = fakeBinding(0);
    const env = validEnv({ RATE_LIMIT_MODE: "enforce", RL_NEWSLETTER, RL_DONATION });
    const news = await app.fetch(postJson("/api/forms/newsletter", { email: "a@example.com" }), env);
    const pix = await app.fetch(postJson("/api/donations/create-pix", { amountCents: 5000 }), env);
    expect(news.status).toBe(429);
    expect(pix.status).toBe(429);
    expect(RL_NEWSLETTER.limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
  });

  it("não limita webhook de pagamento, preflight CORS nem /health", async () => {
    const all = Object.fromEntries(["RL_CONTACT", "RL_TRIAGE", "RL_NEWSLETTER", "RL_DONATION"].map((k) => [k, fakeBinding(0)]));
    const env = validEnv({ RATE_LIMIT_MODE: "enforce", ...all });
    const webhook = await app.fetch(new Request(`${API}/api/webhooks/payment`, { method: "POST", body: "{}", headers: ip }), env);
    expect(webhook.status).not.toBe(429);
    const preflight = await app.fetch(
      new Request(`${API}/api/forms/contato`, { method: "OPTIONS", headers: { Origin: SITE, "Access-Control-Request-Method": "POST", ...ip } }),
      env
    );
    expect(preflight.status).not.toBe(429);
    expect((await app.fetch(new Request(`${API}/health`, { headers: ip }), env)).status).toBe(200);
    for (const b of Object.values(all)) expect(b.limit).not.toHaveBeenCalled();
  });

  it("formulário nativo da newsletter sem JavaScript segue funcionando abaixo do limite", async () => {
    const RL_NEWSLETTER = fakeBinding(5);
    const env = validEnv({ RATE_LIMIT_MODE: "enforce", RL_NEWSLETTER });
    const res = await app.fetch(
      new Request(`${API}/api/forms/newsletter`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: SITE, ...ip },
        body: "email=a%40example.com&policyVersion=2026-09-19",
      }),
      env
    );
    expect(res.status).not.toBe(429);
    expect(res.status).not.toBe(403);
  });

  it("requisição sem Origin nem Sec-Fetch-Site é recusada com 403 nas rotas de formulário e doação", async () => {
    const env = validEnv();
    for (const path of ["/api/forms/contato", "/api/forms/triagem", "/api/forms/newsletter", "/api/donations/create-pix"]) {
      const res = await app.fetch(
        new Request(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: "{}" }),
        env
      );
      expect(res.status, path).toBe(403);
    }
  });
});
