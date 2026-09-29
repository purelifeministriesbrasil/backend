import { describe, it, expect } from "vitest";
import { app, type Env } from "../src/index.js";

describe("Hono Router & Security Middleware Integration", () => {
  const mockEnv: Env = {
    PUBLIC_SITE_ORIGIN: "https://purelifebrasil.org",
    ENVIRONMENT: "test",
    TURNSTILE_SECRET_KEY: "cf-test-secret",
  };

  it("handles GET /health with 200 and healthy status", async () => {
    const req = new Request("https://api.purelifebrasil.org/health", {
      method: "GET",
    });
    const res = await app.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("healthy");
    expect(body.service).toBe("purelife-api");
  });

  it("handles unmatched route with 404 not_found JSON", async () => {
    const req = new Request("https://api.purelifebrasil.org/api/nonexistent", {
      method: "GET",
    });
    const res = await app.fetch(req, mockEnv);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe("not_found");
  });

  it("sets security headers on all responses", async () => {
    const req = new Request("https://api.purelifebrasil.org/health", {
      method: "GET",
    });
    const res = await app.fetch(req, mockEnv);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("handles OPTIONS preflight for CORS on /api/* routes", async () => {
    const req = new Request("https://api.purelifebrasil.org/api/forms/triagem", {
      method: "OPTIONS",
      headers: {
        Origin: "https://purelifebrasil.org",
        "Access-Control-Request-Method": "POST",
      },
    });
    const res = await app.fetch(req, mockEnv);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://purelifebrasil.org");
  });

  it("returns 503 if DATABASE_URL is not configured when submitting triage", async () => {
    const req = new Request("https://api.purelifebrasil.org/api/forms/triagem", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://purelifebrasil.org",
      },
      body: JSON.stringify({ test: true }),
    });
    const res = await app.fetch(req, { ...mockEnv, DATABASE_URL: undefined });
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.error).toBe("service_unavailable");
  });
});
