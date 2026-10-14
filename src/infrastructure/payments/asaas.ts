import type {
  PaymentGateway,
  CreatePixInput,
  CreatePixResult,
  PaymentEventType,
  VerifiedPaymentEvent,
  WebhookVerificationError,
} from "../../application/ports/payment-gateway.js";
import type { UseCaseResult } from "../../application/ports/result.js";
import { timingSafeEqual } from "../crypto/hashing.js";
import { fetchWithTimeout } from "../http/fetch.js";
import { log } from "../observability/logger.js";
import { brtDate, parseBrtLocal } from "./brt.js";

export interface AsaasConfig {
  apiKey: string;
  webhookSecret: string;
  /** Cliente institucional "Doador Anônimo": o Asaas exige `customer` com CPF/CNPJ em toda cobrança. */
  donationCustomerId: string;
  apiBaseUrl: string;
  pixExpirationMinutes: number;
}

/** Eventos de cobrança relevantes para Pix (docs.asaas.com — "Eventos para cobranças"). */
const EVENT_MAP: Record<string, PaymentEventType> = {
  PAYMENT_RECEIVED: "payment.confirmed",
  PAYMENT_CONFIRMED: "payment.confirmed",
  PAYMENT_OVERDUE: "payment.expired",
  PAYMENT_DELETED: "payment.cancelled",
  PAYMENT_REFUNDED: "payment.refunded",
};

type GatewayFailure = { ok: false; kind: "infrastructure"; error: "gateway_rejected" | "gateway_unavailable"; retryable: boolean };

const unavailable: GatewayFailure = { ok: false, kind: "infrastructure", error: "gateway_unavailable", retryable: true };
const rejected: GatewayFailure = { ok: false, kind: "infrastructure", error: "gateway_rejected", retryable: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createAsaasGateway(config: AsaasConfig, timeoutMs = 10_000): PaymentGateway {
  const headers = {
    access_token: config.apiKey,
    "Content-Type": "application/json",
    "User-Agent": "purelife-api",
  };

  async function call(path: string, init: RequestInit): Promise<{ status: number; body: unknown } | null> {
    try {
      const res = await fetchWithTimeout(`${config.apiBaseUrl}${path}`, { ...init, headers, timeoutMs });
      return { status: res.status, body: await res.json().catch(() => null) };
    } catch (err) {
      log("warn", "asaas.request_failed", { path: path.split("/")[1], reason: err instanceof Error ? err.name : "unknown" });
      return null;
    }
  }

  return {
    provider: "asaas",

    async createPix(input: CreatePixInput): Promise<UseCaseResult<CreatePixResult, "gateway_rejected" | "gateway_unavailable">> {
      const now = new Date();
      const created = await call("/payments", {
        method: "POST",
        body: JSON.stringify({
          customer: config.donationCustomerId,
          billingType: "PIX",
          value: Number((input.amountCents / 100).toFixed(2)),
          dueDate: brtDate(now),
          description: input.description,
          externalReference: input.externalReference,
        }),
      });
      if (!created) return unavailable;
      if (created.status >= 500) return unavailable;
      if (created.status >= 400 || !isRecord(created.body) || typeof created.body.id !== "string") {
        log("warn", "asaas.charge_rejected", { status: created.status });
        return rejected;
      }

      const paymentId = created.body.id;
      const qr = await call(`/payments/${encodeURIComponent(paymentId)}/pixQrCode`, { method: "GET" });
      if (!qr || qr.status >= 500) return unavailable;
      if (qr.status >= 400 || !isRecord(qr.body) || typeof qr.body.payload !== "string") {
        log("warn", "asaas.qrcode_rejected", { status: qr.status });
        return rejected;
      }

      const expiresAt =
        parseBrtLocal(qr.body.expirationDate) ?? new Date(now.getTime() + config.pixExpirationMinutes * 60_000);

      return {
        ok: true,
        value: { providerChargeId: paymentId, pixCopyPaste: qr.body.payload, expiresAt: expiresAt.toISOString() },
      };
    },

    async verifyWebhook({ rawBody, headers: reqHeaders }): Promise<UseCaseResult<VerifiedPaymentEvent, WebhookVerificationError>> {
      // Token obrigatório e comparado em tempo constante (fail-closed: sem segredo, nada passa).
      const token = reqHeaders.get("asaas-access-token") ?? "";
      if (!config.webhookSecret || !timingSafeEqual(token, config.webhookSecret)) {
        return { ok: false, kind: "expected", error: "invalid_signature", message: "Token de webhook do Asaas inválido." };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return { ok: false, kind: "expected", error: "malformed_payload", message: "JSON do webhook malformado." };
      }

      const payment = isRecord(payload) ? payload.payment : undefined;
      if (
        !isRecord(payload) ||
        typeof payload.id !== "string" ||
        typeof payload.event !== "string" ||
        !isRecord(payment) ||
        typeof payment.id !== "string"
      ) {
        return { ok: false, kind: "expected", error: "malformed_payload", message: "Evento do Asaas sem campos obrigatórios." };
      }

      const value = typeof payment.value === "number" ? payment.value : 0;
      const occurredAt = parseBrtLocal(payload.dateCreated) ?? new Date();

      return {
        ok: true,
        value: {
          provider: "asaas",
          eventId: payload.id.slice(0, 128),
          eventType: EVENT_MAP[payload.event] ?? "unknown",
          providerChargeId: payment.id.slice(0, 128),
          amountCents: Math.round(value * 100),
          occurredAt: occurredAt.toISOString(),
        },
      };
    },
  };
}
