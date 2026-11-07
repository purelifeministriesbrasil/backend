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


  type CreateOutcome = UseCaseResult<CreatePixResult, "gateway_rejected" | "gateway_unavailable">;

  /** Busca o QR Code Pix de uma cobrança e monta o resultado; `expirationDate` ausente usa a expiração padrão. */
  async function fetchQr(
    paymentId: string,
    now: Date,
    opts: { requireExpiration?: boolean } = {}
  ): Promise<CreateOutcome> {
    const qr = await call(`/payments/${encodeURIComponent(paymentId)}/pixQrCode`, { method: "GET" });
    if (!qr || qr.status >= 500) return unavailable;
    if (qr.status >= 400 || !isRecord(qr.body) || typeof qr.body.payload !== "string") {
      log("warn", "asaas.qrcode_rejected", { status: qr.status });
      return rejected;
    }
    const parsed = parseBrtLocal(qr.body.expirationDate);
    if (!parsed && opts.requireExpiration) {
      log("warn", "asaas.reconcile_blocked", { reason: "qr_without_expiration" });
      return rejected;
    }
    const expiresAt = parsed ?? new Date(now.getTime() + config.pixExpirationMinutes * 60_000);
    return {
      ok: true,
      value: { providerChargeId: paymentId, pixCopyPaste: qr.body.payload, expiresAt: expiresAt.toISOString() },
    };
  }

  /**
   * Procura cobranças já criadas para a intenção. Nunca assume que uma cobrança encontrada é reutilizável:
   * - reaproveita só PENDING, não removida, Pix, com o mesmo valor e QR ainda não expirado;
   * - ignora removidas (`deleted`), vencidas (OVERDUE) e PENDING com QR já expirado;
   * - qualquer outro estado (paga, estornada, valor divergente, desconhecido) BLOQUEIA a criação de nova
   *   cobrança e exige conciliação manual, em vez de arriscar cobrar o doador duas vezes.
   * Retorna `null` quando é seguro criar uma nova cobrança.
   * Falha ao consultar também bloqueia: sem saber se já existe, criar poderia duplicar.
   */
  async function findExisting(input: CreatePixInput, now: Date): Promise<CreateOutcome | null> {
    const query = new URLSearchParams({ externalReference: input.externalReference, billingType: "PIX", limit: "100" });
    const listed = await call(`/payments?${query.toString()}`, { method: "GET" });
    if (!listed || listed.status >= 500) return unavailable;
    if (listed.status >= 400 || !isRecord(listed.body) || !Array.isArray(listed.body.data)) {
      log("warn", "asaas.reconcile_list_rejected", { status: listed.status });
      return rejected;
    }
    if (listed.body.hasMore === true) {
      log("warn", "asaas.reconcile_blocked", { reason: "too_many_payments" });
      return rejected;
    }

    const reusable: { id: string; dateCreated: string }[] = [];
    for (const item of listed.body.data) {
      if (!isRecord(item) || typeof item.id !== "string") {
        log("warn", "asaas.reconcile_blocked", { reason: "malformed_item" });
        return rejected;
      }
      if (item.deleted === true || item.status === "OVERDUE") continue; // removida ou vencida: não reutilizar
      const sameAmount = typeof item.value === "number" && Math.round(item.value * 100) === input.amountCents;
      if (item.status === "PENDING" && item.billingType === "PIX" && sameAmount) {
        reusable.push({ id: item.id, dateCreated: typeof item.dateCreated === "string" ? item.dateCreated : "" });
        continue;
      }
      log("warn", "asaas.reconcile_blocked", {
        reason: "existing_payment_not_reusable",
        status: typeof item.status === "string" ? item.status.slice(0, 40) : "unknown",
      });
      return rejected;
    }

    reusable.sort((a, b) => a.dateCreated.localeCompare(b.dateCreated));
    for (const candidate of reusable) {
      const qr = await fetchQr(candidate.id, now, { requireExpiration: true });
      if (!qr.ok) return qr;
      if (new Date(qr.value.expiresAt).getTime() <= now.getTime()) continue; // QR expirado: não reutilizar
      log("info", "asaas.charge_reused", { reconciled: true });
      return qr;
    }
    return null;
  }

  return {
    provider: "asaas",

    async createPix(input: CreatePixInput): Promise<UseCaseResult<CreatePixResult, "gateway_rejected" | "gateway_unavailable">> {
      const now = new Date();

      // 1) Conciliação ANTES de criar: o Asaas não recebe chave de idempotência (header equivalente não
      //    comprovado na documentação). Uma cobrança criada numa tentativa anterior, cuja gravação local
      //    falhou, é localizada por `externalReference` (id estável da intenção).
      const found = await findExisting(input, now);
      if (found) return found; // cobrança reaproveitada (ok) ou falha/bloqueio da conciliação

      // 2) Nenhuma cobrança aproveitável: cria. Falhas aqui (antes do id remoto) não deixam cobrança.
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

      // 3) Cobrança já existe no Asaas. Se o QR falhar agora, a retentativa a reencontra no passo 1.
      const paymentId = created.body.id;
      const qr = await fetchQr(paymentId, now);
      if (!qr.ok) {
        log("warn", "asaas.qrcode_failed_after_create", { reconcilable: true });
        return qr;
      }
      return { ok: true, value: qr.value };
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
