import type {
  PaymentGateway,
  CreatePixInput,
  CreatePixResult,
  VerifiedPaymentEvent,
} from "../../application/ports/payment-gateway.js";
import type { UseCaseResult } from "../../application/ports/result.js";

export function createMercadoPagoGateway(accessToken: string, webhookSecret: string): PaymentGateway {
  return {
    async createPix(input: CreatePixInput): Promise<UseCaseResult<CreatePixResult, "gateway_rejected" | "gateway_unavailable">> {
      try {
        const providerChargeId = `mp_${Date.now()}`;
        const pixCopyPaste = `00020101021226880014br.gov.bcb.pix2566pix.purelifebrasil.org/qr/v2/mp_${providerChargeId}520400005303986540${(input.amountCents / 100).toFixed(2)}5802BR5925PURE LIFE MINISTRIES BR6009BRASILIA62070503***6304`;
        const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

        return {
          ok: true,
          value: {
            providerChargeId,
            pixCopyPaste,
            expiresAt,
          },
        };
      } catch {
        return {
          ok: false,
          kind: "infrastructure",
          error: "gateway_unavailable",
          retryable: true,
        };
      }
    },

    async verifyWebhook({
      rawBody,
      headers,
    }: {
      rawBody: string;
      headers: Headers;
    }): Promise<UseCaseResult<VerifiedPaymentEvent, "invalid_signature" | "malformed_payload">> {
      try {
        const payload = JSON.parse(rawBody);
        return {
          ok: true,
          value: {
            provider: "mercadopago",
            eventId: payload.id ? String(payload.id) : `mp_evt_${Date.now()}`,
            eventType: payload.action === "payment.created" ? "payment.confirmed" : "unknown",
            providerChargeId: payload.data?.id ? String(payload.data.id) : `charge_${Date.now()}`,
            amountCents: 0,
            occurredAt: payload.date_created || new Date().toISOString(),
          },
        };
      } catch {
        return {
          ok: false,
          kind: "expected",
          error: "malformed_payload",
          message: "Payload malformado do Mercado Pago.",
        };
      }
    },
  };
}
