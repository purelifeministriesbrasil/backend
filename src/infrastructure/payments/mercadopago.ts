import type {
  PaymentGateway,
  CreatePixInput,
  CreatePixResult,
  PaymentEventType,
  VerifiedPaymentEvent,
  WebhookVerificationError,
} from "../../application/ports/payment-gateway.js";
import type { UseCaseResult } from "../../application/ports/result.js";
import { hmacSha256Hex, timingSafeEqual } from "../crypto/hashing.js";
import { fetchWithTimeout } from "../http/fetch.js";
import { log } from "../observability/logger.js";
import { brtTimestamp } from "./brt.js";

export interface MercadoPagoConfig {
  accessToken: string;
  webhookSecret: string;
  /** O Mercado Pago exige `payer.email`; usado quando o doador não informa e-mail. */
  payerFallbackEmail: string;
  pixExpirationMinutes: number;
}

const API_BASE = "https://api.mercadopago.com";

type GatewayFailure = { ok: false; kind: "infrastructure"; error: "gateway_rejected" | "gateway_unavailable"; retryable: boolean };
const unavailable: GatewayFailure = { ok: false, kind: "infrastructure", error: "gateway_unavailable", retryable: true };
const rejected: GatewayFailure = { ok: false, kind: "infrastructure", error: "gateway_rejected", retryable: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Mapeia o status do pagamento (GET /v1/payments/{id}) para o evento de domínio. */
function mapStatus(status: unknown, statusDetail: unknown): PaymentEventType {
  switch (status) {
    case "approved":
      return "payment.confirmed";
    case "rejected":
      return "payment.failed";
    case "cancelled":
      return statusDetail === "expired" ? "payment.expired" : "payment.cancelled";
    case "refunded":
    case "charged_back":
      return "payment.refunded";
    default:
      return "unknown"; // pending, in_process, authorized, in_mediation
  }
}

/** Interpreta `x-signature: ts=<epoch>,v1=<hex>`. */
function parseSignature(header: string): { ts: string; v1: string } | null {
  const parts = new Map<string, string>();
  for (const piece of header.split(",")) {
    const [key, ...rest] = piece.split("=");
    if (key && rest.length > 0) parts.set(key.trim(), rest.join("=").trim());
  }
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  return ts && v1 ? { ts, v1 } : null;
}

export function createMercadoPagoGateway(config: MercadoPagoConfig, timeoutMs = 10_000): PaymentGateway {
  const authHeaders = { Authorization: `Bearer ${config.accessToken}` };

  return {
    provider: "mercadopago",

    async createPix(input: CreatePixInput): Promise<UseCaseResult<CreatePixResult, "gateway_rejected" | "gateway_unavailable">> {
      const expiresAt = new Date(Date.now() + config.pixExpirationMinutes * 60_000);
      let res: Response;
      try {
        res = await fetchWithTimeout(`${API_BASE}/v1/payments`, {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
            "X-Idempotency-Key": input.idempotencyKey,
          },
          body: JSON.stringify({
            transaction_amount: Number((input.amountCents / 100).toFixed(2)),
            description: input.description,
            payment_method_id: "pix",
            date_of_expiration: brtTimestamp(expiresAt),
            external_reference: input.externalReference,
            payer: { email: input.donorEmail ?? config.payerFallbackEmail },
          }),
          timeoutMs,
        });
      } catch (err) {
        log("warn", "mercadopago.request_failed", { reason: err instanceof Error ? err.name : "unknown" });
        return unavailable;
      }

      if (res.status >= 500) return unavailable;
      const body: unknown = await res.json().catch(() => null);
      const qrCode =
        isRecord(body) && isRecord(body.point_of_interaction) && isRecord(body.point_of_interaction.transaction_data)
          ? body.point_of_interaction.transaction_data.qr_code
          : undefined;

      if (res.status >= 400 || !isRecord(body) || body.id === undefined || typeof qrCode !== "string") {
        log("warn", "mercadopago.charge_rejected", { status: res.status });
        return rejected;
      }

      const providerExpiry = typeof body.date_of_expiration === "string" ? new Date(body.date_of_expiration) : null;
      return {
        ok: true,
        value: {
          providerChargeId: String(body.id),
          pixCopyPaste: qrCode,
          expiresAt: (providerExpiry && !Number.isNaN(providerExpiry.getTime()) ? providerExpiry : expiresAt).toISOString(),
        },
      };
    },

    async verifyWebhook({ rawBody, headers, url }): Promise<UseCaseResult<VerifiedPaymentEvent, WebhookVerificationError>> {
      const invalid = { ok: false as const, kind: "expected" as const, error: "invalid_signature" as const, message: "Assinatura do Mercado Pago inválida." };

      const signature = parseSignature(headers.get("x-signature") ?? "");
      if (!config.webhookSecret || !signature) return invalid;

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return { ok: false, kind: "expected", error: "malformed_payload", message: "Payload malformado do Mercado Pago." };
      }

      const query = new URL(url).searchParams;
      const bodyDataId = isRecord(payload) && isRecord(payload.data) ? payload.data.id : undefined;
      const dataId = query.get("data.id") ?? (bodyDataId !== undefined ? String(bodyDataId) : null);
      const requestId = headers.get("x-request-id");

      // Manifesto oficial: "id:{data.id};request-id:{x-request-id};ts:{ts};" — partes ausentes são omitidas.
      const manifest =
        (dataId ? `id:${dataId};` : "") + (requestId ? `request-id:${requestId};` : "") + `ts:${signature.ts};`;
      const expected = await hmacSha256Hex(config.webhookSecret, manifest);
      if (!timingSafeEqual(signature.v1.toLowerCase(), expected)) return invalid;

      const topic = query.get("type") ?? (isRecord(payload) ? payload.type : undefined);
      if (!dataId || !/^\d{1,32}$/.test(dataId)) {
        return { ok: false, kind: "expected", error: "malformed_payload", message: "Notificação sem data.id válido." };
      }

      if (topic !== "payment") {
        return {
          ok: true,
          value: {
            provider: "mercadopago",
            eventId: `${String(topic).slice(0, 32)}:${dataId}`,
            eventType: "unknown",
            providerChargeId: dataId,
            amountCents: 0,
            occurredAt: new Date().toISOString(),
          },
        };
      }

      // A notificação não traz status nem valor: a fonte da verdade é a consulta autenticada.
      let res: Response;
      try {
        res = await fetchWithTimeout(`${API_BASE}/v1/payments/${dataId}`, { headers: authHeaders, timeoutMs });
      } catch {
        return { ok: false, kind: "infrastructure", error: "gateway_unavailable", retryable: true };
      }
      if (res.status >= 500 || res.status === 429) {
        return { ok: false, kind: "infrastructure", error: "gateway_unavailable", retryable: true };
      }
      const payment: unknown = await res.json().catch(() => null);
      if (!res.ok || !isRecord(payment)) {
        return { ok: false, kind: "expected", error: "malformed_payload", message: "Pagamento não encontrado no Mercado Pago." };
      }

      const eventType = mapStatus(payment.status, payment.status_detail);
      const amount = typeof payment.transaction_amount === "number" ? payment.transaction_amount : 0;
      const updatedAt = typeof payment.date_last_updated === "string" ? new Date(payment.date_last_updated) : new Date();

      return {
        ok: true,
        value: {
          provider: "mercadopago",
          // Deduplica por (pagamento, status): notificações repetidas do mesmo estado colapsam.
          eventId: `payment:${dataId}:${String(payment.status)}`.slice(0, 128),
          eventType,
          providerChargeId: dataId,
          amountCents: Math.round(amount * 100),
          occurredAt: (Number.isNaN(updatedAt.getTime()) ? new Date() : updatedAt).toISOString(),
        },
      };
    },
  };
}
