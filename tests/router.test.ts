import { describe, it, expect } from "vitest";
import { app, createApp } from "../src/index.js";
import { SITE, jsonRequest, validEnv, validTriage } from "./helpers.js";

describe("Hono Router & Security Middleware Integration", () => {
  const env = validEnv();
  const key = () => ({ "Idempotency-Key": crypto.randomUUID() });

  it("handles GET /health with 200 and healthy status", async () => {
    const res = await app.fetch(new Request("https://api.purelifeministriesbrasil.org/health"), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe("healthy");
    expect(body.service).toBe("purelife-api");
  });

  it("handles unmatched route with 404 not_found JSON", async () => {
    const res = await app.fetch(new Request("https://api.purelifeministriesbrasil.org/api/nonexistent"), env);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("not_found");
  });

  it("sets security headers on all responses", async () => {
    const res = await app.fetch(new Request("https://api.purelifeministriesbrasil.org/health"), env);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
  });

  it("answers CORS preflight for the configured origin and allows Idempotency-Key", async () => {
    const res = await app.fetch(
      new Request("https://api.purelifeministriesbrasil.org/api/forms/triagem", {
        method: "OPTIONS",
        headers: {
          Origin: SITE,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,idempotency-key",
        },
      }),
      env
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(SITE);
    expect(res.headers.get("Access-Control-Allow-Headers")?.toLowerCase()).toContain("idempotency-key");
  });

  it("does not reflect CORS for foreign origins", async () => {
    const res = await app.fetch(
      new Request("https://api.purelifeministriesbrasil.org/api/forms/triagem", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
      }),
      env
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("rejects localhost origins in production", async () => {
    const res = await app.fetch(
      new Request("https://api.purelifeministriesbrasil.org/api/forms/triagem", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:4321", "Access-Control-Request-Method": "POST" },
      }),
      validEnv({ ENVIRONMENT: "production" })
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("fails closed with 503 when DATABASE_URL is missing, without consuming the Turnstile token", async () => {
    let turnstileCalls = 0;
    const testApp = createApp({ verifyTurnstile: async () => (turnstileCalls++, true) });
    const res = await testApp.fetch(
      jsonRequest("/api/forms/triagem", validTriage, key()),
      validEnv({ DATABASE_URL: undefined })
    );
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("service_unavailable");
    expect(turnstileCalls).toBe(0);
  });

  it("fails closed with 503 when the AES key is not 32 bytes", async () => {
    const testApp = createApp({ verifyTurnstile: async () => true });
    const res = await testApp.fetch(
      jsonRequest("/api/forms/triagem", validTriage, key()),
      validEnv({ TRIAGE_KEY_V1: btoa("curta-demais") })
    );
    expect(res.status).toBe(503);
  });

  it("fails closed with 503 when the payment provider is not configured", async () => {
    const testApp = createApp({ verifyTurnstile: async () => true });
    const res = await testApp.fetch(
      jsonRequest("/api/donations/create-pix", { amountCents: 5000, frequency: "one_time", turnstileToken: "x".repeat(20) }, key()),
      validEnv({ PAYMENT_PROVIDER: undefined })
    );
    expect(res.status).toBe(503);
  });

  it("refuses Turnstile test secret keys in production", async () => {
    const testApp = createApp({ verifyTurnstile: async () => true });
    const res = await testApp.fetch(
      jsonRequest("/api/forms/triagem", validTriage, key()),
      validEnv({ ENVIRONMENT: "production" })
    );
    expect(res.status).toBe(503);
  });

  it("requires a valid Idempotency-Key on form submissions", async () => {
    const testApp = createApp({ verifyTurnstile: async () => true });
    const res = await testApp.fetch(jsonRequest("/api/forms/triagem", validTriage, { "Idempotency-Key": "abc" }), env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_idempotency_key");
  });

  it("rejects declared bodies above the limit before reading them", async () => {
    const testApp = createApp({ verifyTurnstile: async () => true });
    const res = await testApp.fetch(
      jsonRequest("/api/forms/triagem", validTriage, { ...key(), "Content-Length": "999999" }),
      env
    );
    expect(res.status).toBe(413);
  });
});
