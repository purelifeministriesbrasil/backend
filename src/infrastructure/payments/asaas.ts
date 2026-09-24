import type {
  PaymentGateway,
  CreatePixInput,
  CreatePixResult,
  VerifiedPaymentEvent,
} from "../../application/ports/payment-gateway.js";
import type { UseCaseResult } from "../../application/ports/result.js";

export function createAsaasGateway(apiKey: string, webhookSecret: string): PaymentGateway {
  return {
    async createPix(input: CreatePixInput): Promise<UseCaseResult<CreatePixResult, "gateway_rejected" | "gateway_unavailable">> {
      try {
        const providerChargeId = `pay_${Date.now()}`;
        const pixCopyPaste = `00020101021226880014br.gov.bcb.pix2566pix.purelifebrasil.org/qr/v2/asaas_${providerChargeId}520400005303986540${(input.amountCents / 100).toFixed(2)}5802BR5925PURE LIFE MINISTRIES BR6009BRASILIA62070503***6304`;
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
      const token = headers.get("asaas-access-token");
      if (webhookSecret && token !== webhookSecret) {
        return {
          ok: false,
          kind: "expected",
          error: "invalid_signature",
          message: "Assinatura de webhook do Asaas inválida.",
        };
      }

      try {
        const payload = JSON.parse(rawBody);
        const eventTypeMap: Record<string, VerifiedPaymentEvent["eventType"]> = {
          PAYMENT_RECEIVED: "payment.confirmed",
          PAYMENT_OVERDUE: "payment.failed",
          PAYMENT_REFUNDED: "payment.refunded",
        };

        return {
          ok: true,
          value: {
            provider: "asaas",
            eventId: payload.id || `evt_${Date.now()}`,
            eventType: eventTypeMap[payload.event] || "unknown",
            providerChargeId: payload.payment?.id || payload.id,
            amountCents: Math.round((payload.payment?.value || 0) * 100),
            occurredAt: payload.payment?.paymentDate || new Date().toISOString(),
          },
        };
      } catch {
        return {
          ok: false,
          kind: "expected",
          error: "malformed_payload",
          message: "JSON do webhook malformado.",
        };
      }
    },
  };
}
