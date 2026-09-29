import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { handleHealth } from "./presentation/health.js";
import { handleTriageSubmission } from "./presentation/forms/triagem.js";
import { handleContactSubmission } from "./presentation/forms/contato.js";
import { handleNewsletterSubscription } from "./presentation/forms/newsletter.js";
import { handleCreatePix } from "./presentation/donations/create-pix.js";
import { handlePaymentWebhook } from "./presentation/webhooks/payment.js";
import { createAesGcmProvider } from "./infrastructure/crypto/aes-gcm.js";
import { createTriageUnitOfWork } from "./infrastructure/db/unit-of-work.js";
import { createAsaasGateway } from "./infrastructure/payments/asaas.js";
import { createIdempotencyRepository } from "./infrastructure/db/idempotency.js";
import { createDbClient } from "./infrastructure/db/db.js";
import { createDrizzlePurgeRepository } from "./infrastructure/db/purge-repository.js";
import { verifyTurnstileToken } from "./infrastructure/security/turnstile.js";
import { handleScheduledPurge } from "./presentation/cron/purge.js";

export interface Env {
  PUBLIC_SITE_ORIGIN: string;
  ENVIRONMENT: string;
  DATABASE_URL?: string;
  TRIAGE_KEY_V1?: string;
  ASAAS_API_KEY?: string;
  ASAAS_WEBHOOK_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
}

export const app = new Hono<{ Bindings: Env }>();

// Security headers middleware
app.use("*", secureHeaders());

// Scoped CORS middleware
app.use("/api/*", async (c, next) => {
  const allowedOrigin = c.env?.PUBLIC_SITE_ORIGIN ?? "https://purelifebrasil.org";
  const corsMiddleware = cors({
    origin: (origin) => {
      if (!origin) return allowedOrigin;
      if (origin === allowedOrigin) return origin;
      if (c.env?.ENVIRONMENT !== "production") {
        if (origin.startsWith("http://localhost:") || origin.endsWith(".vercel.app")) {
          return origin;
        }
      }
      return null;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Accept", "CF-Connecting-IP"],
    maxAge: 86400,
  });
  return corsMiddleware(c, next);
});

app.get("/health", async () => {
  return handleHealth();
});

app.post("/api/forms/triagem", async (c) => {
  const env = c.env;
  const turnstileSecret = env.TURNSTILE_SECRET_KEY ?? "";
  const cryptoProvider = createAesGcmProvider(
    { 1: env.TRIAGE_KEY_V1 ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
    1
  );

  if (!env.DATABASE_URL) {
    return c.json({ error: "service_unavailable", message: "Database not configured." }, 503);
  }

  const db = createDbClient(env.DATABASE_URL);
  const uow = createTriageUnitOfWork(db as any, cryptoProvider);

  return handleTriageSubmission(c.req.raw, env, uow, {
    turnstileSecret,
    verifyTurnstile: verifyTurnstileToken,
  });
});

app.post("/api/forms/contato", async (c) => {
  const env = c.env;
  return handleContactSubmission(c.req.raw, env, {
    turnstileSecret: env.TURNSTILE_SECRET_KEY ?? "",
    verifyTurnstile: verifyTurnstileToken,
  });
});

app.post("/api/forms/newsletter", async (c) => {
  return handleNewsletterSubscription(c.req.raw, c.env);
});

app.post("/api/donations/create-pix", async (c) => {
  const env = c.env;
  const gateway = createAsaasGateway(
    env.ASAAS_API_KEY ?? "mock-api-key",
    env.ASAAS_WEBHOOK_SECRET ?? "mock-secret"
  );
  return handleCreatePix(c.req.raw, env, gateway, {
    turnstileSecret: env.TURNSTILE_SECRET_KEY ?? "",
    verifyTurnstile: verifyTurnstileToken,
  });
});

app.post("/api/webhooks/payment", async (c) => {
  const env = c.env;
  const gateway = createAsaasGateway(
    env.ASAAS_API_KEY ?? "mock-api-key",
    env.ASAAS_WEBHOOK_SECRET ?? "mock-secret"
  );

  if (!env.DATABASE_URL) {
    return c.json({ error: "service_unavailable" }, 503);
  }

  const db = createDbClient(env.DATABASE_URL);
  const idempotency = createIdempotencyRepository(db);
  const chargeRepo = {
    findByProviderChargeId: async (_providerChargeId: string) => null as any,
    updateStatus: async () => {},
    recordAudit: async () => {},
  };

  return handlePaymentWebhook(c.req.raw, {
    gateway,
    idempotency,
    chargeRepo,
    clock: { now: () => new Date() },
  });
});

app.notFound((c) => {
  return c.json({ error: "not_found" }, 404);
});

export default {
  fetch(request: Request, env: Env, ctx: any): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async scheduled(_event: any, env: Env, ctx: any): Promise<void> {
    if (!env.DATABASE_URL) return;
    const db = createDbClient(env.DATABASE_URL);
    const purgeRepo = createDrizzlePurgeRepository(db);
    ctx.waitUntil(handleScheduledPurge(purgeRepo));
  },
};
