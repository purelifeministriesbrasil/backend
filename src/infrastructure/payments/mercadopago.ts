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
      // Mercado Pago webhook signature validation using HMAC-SHA256 (§8.3)
      // Header: x-signature contains ts=<timestamp>,v1=<hmac>
      const xSignature = headers.get("x-signature");
      const xRequestId = headers.get("x-request-id");

      if (webhookSecret && xSignature) {
        const parts = Object.fromEntries(
          xSignature.split(",").map((p) => p.split("=") as [string, string])
        );
        const ts = parts["ts"];
        const v1 = parts["v1"];

        if (!ts || !v1) {
          return {
            ok: false,
            kind: "expected",
            error: "invalid_signature",
            message: "Assinatura do Mercado Pago ausente ou malformada.",
          };
        }

        // Reconstruct signed template: id:{id};request-id:{requestId};ts:{ts};
        let dataId: string | undefined;
        try {
          const payload = JSON.parse(rawBody);
          dataId = payload.data?.id ? String(payload.data.id) : undefined;
        } catch {
          // will fail later in parse
        }

        const template = `id:${dataId ?? ""};request-id:${xRequestId ?? ""};ts:${ts};`;

        const encoder = new TextEncoder();
        const keyData = encoder.encode(webhookSecret);
        const messageData = encoder.encode(template);

        const cryptoKey = await crypto.subtle.importKey(
          "raw",
          keyData,
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        );

        const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
        const expectedHex = Array.from(new Uint8Array(signature))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        if (v1 !== expectedHex) {
          return {
            ok: false,
            kind: "expected",
            error: "invalid_signature",
            message: "Assinatura HMAC do Mercado Pago inválida.",
          };
        }
      } else if (webhookSecret && !xSignature) {
        // Signature required but not present
        return {
          ok: false,
          kind: "expected",
          error: "invalid_signature",
          message: "Header x-signature ausente no webhook do Mercado Pago.",
        };
      }

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
