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

import { handleScheduledPurge } from "./presentation/cron/purge.js";

export interface Env {
  PUBLIC_SITE_ORIGIN: string;
  ENVIRONMENT: string;
  DATABASE_URL?: string;
  TRIAGE_KEY_V1?: string;
  ASAAS_API_KEY?: string;
  ASAAS_WEBHOOK_SECRET?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/health") {
      return handleHealth();
    }

    if (path === "/api/forms/triagem") {
      // Cria provider de criptografia com chave de segredo injetada
      const dummyKey = env.TRIAGE_KEY_V1 || "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
      const cryptoProvider = createAesGcmProvider({ 1: dummyKey }, 1);

      // Mock de transação para ambiente sem conexão direta com Neon
      const dbMock = {
        transaction: async (cb: any) =>
          cb({
            insert: () => ({
              values: () => ({
                returning: async () => [{ id: crypto.randomUUID() }],
              }),
            }),
            update: () => ({
              set: () => ({
                where: async () => {},
              }),
            }),
          }),
      };

      const uow = createTriageUnitOfWork(dbMock as any, cryptoProvider);
      return handleTriageSubmission(request, env, uow);
    }

    if (path === "/api/forms/contato") {
      return handleContactSubmission(request, env);
    }

    if (path === "/api/forms/newsletter") {
      return handleNewsletterSubscription(request, env);
    }

    if (path === "/api/donations/create-pix") {
      const gateway = createAsaasGateway(
        env.ASAAS_API_KEY || "mock-api-key",
        env.ASAAS_WEBHOOK_SECRET || "mock-secret"
      );
      return handleCreatePix(request, env, gateway);
    }

    if (path === "/api/webhooks/payment") {
      const gateway = createAsaasGateway(
        env.ASAAS_API_KEY || "mock-api-key",
        env.ASAAS_WEBHOOK_SECRET || "mock-secret"
      );
      const idempotency = createIdempotencyRepository({
        execute: async () => ({ rows: [{ attempts: 1, was_insert: true }] }),
        update: () => ({ set: () => ({ where: async () => {} }) }),
        select: () => ({ from: () => ({ where: async () => [] }) }),
      });
      const chargeRepo = {
        findByProviderChargeId: async () => ({
          id: crypto.randomUUID(),
          status: "pending" as const,
          amountCents: 5000,
        }),
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

  async scheduled(event: any, env: Env, ctx: any): Promise<void> {
    const purgeRepo = {
      findExpiredSubmissions: async () => [],
      purgeSubmission: async () => true,
    };
    ctx.waitUntil(handleScheduledPurge(purgeRepo));
  },
};

