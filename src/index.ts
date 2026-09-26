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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/health") {
      return handleHealth();
    }

    if (path === "/api/forms/triagem") {
      const turnstileSecret = env.TURNSTILE_SECRET_KEY ?? "";
      const cryptoProvider = createAesGcmProvider(
        { 1: env.TRIAGE_KEY_V1 ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
        1
      );

      if (!env.DATABASE_URL) {
        return new Response(JSON.stringify({ error: "service_unavailable", message: "Database not configured." }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }

      const db = createDbClient(env.DATABASE_URL);
      const uow = createTriageUnitOfWork(db as any, cryptoProvider);

      // Validate Turnstile before processing (§7.3)
      // We extract token from body for validation — done inside handler
      return handleTriageSubmission(request, env, uow, {
        turnstileSecret,
        verifyTurnstile: verifyTurnstileToken,
      });
    }

    if (path === "/api/forms/contato") {
      return handleContactSubmission(request, env, {
        turnstileSecret: env.TURNSTILE_SECRET_KEY ?? "",
        verifyTurnstile: verifyTurnstileToken,
      });
    }

    if (path === "/api/forms/newsletter") {
      return handleNewsletterSubscription(request, env);
    }

    if (path === "/api/donations/create-pix") {
      const gateway = createAsaasGateway(
        env.ASAAS_API_KEY ?? "mock-api-key",
        env.ASAAS_WEBHOOK_SECRET ?? "mock-secret"
      );
      return handleCreatePix(request, env, gateway, {
        turnstileSecret: env.TURNSTILE_SECRET_KEY ?? "",
        verifyTurnstile: verifyTurnstileToken,
      });
    }

    if (path === "/api/webhooks/payment") {
      const gateway = createAsaasGateway(
        env.ASAAS_API_KEY ?? "mock-api-key",
        env.ASAAS_WEBHOOK_SECRET ?? "mock-secret"
      );

      if (!env.DATABASE_URL) {
        return new Response(JSON.stringify({ error: "service_unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }

      const db = createDbClient(env.DATABASE_URL);
      const idempotency = createIdempotencyRepository(db);
      const chargeRepo = {
        findByProviderChargeId: async (_providerChargeId: string) => {
          // TODO: implement real charge lookup when paymentCharges table is needed
          return null as any;
        },
        updateStatus: async () => {},
        recordAudit: async () => {},
      };

      return handlePaymentWebhook(request, {
        gateway,
        idempotency,
        chargeRepo,
        clock: { now: () => new Date() },
      });
    }

    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },

  async scheduled(_event: any, env: Env, ctx: any): Promise<void> {
    if (!env.DATABASE_URL) return;
    const db = createDbClient(env.DATABASE_URL);
    const purgeRepo = createDrizzlePurgeRepository(db);
    ctx.waitUntil(handleScheduledPurge(purgeRepo));
  },
};
