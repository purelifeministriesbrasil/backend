import type { UseCaseResult } from "./result.js";

export type PaymentProviderName = "asaas" | "mercadopago";

export interface CreatePixInput {
  amountCents: number;
  description: string;
  donorEmail?: string;
  /** Chave estável por intenção de doação: repassada ao provedor para evitar cobrança duplicada. */
  idempotencyKey: string;
  /** Referência interna (id da intenção) gravada no provedor para conciliação. */
  externalReference: string;
}

/** Sem imagem base64: a ilha cliente gera o QR localmente a partir do payload (§7.1). */
export interface CreatePixResult {
  providerChargeId: string;
  pixCopyPaste: string;
  expiresAt: string; // ISO 8601
}

export type PaymentEventType =
  | "payment.confirmed"
  | "payment.failed"
  | "payment.expired"
  | "payment.cancelled"
  | "payment.refunded"
  | "unknown";

export type VerifiedPaymentEvent = {
  provider: PaymentProviderName;
  eventId: string;
  eventType: PaymentEventType;
  providerChargeId: string;
  amountCents: number;
  occurredAt: string;
};

export type WebhookVerificationError = "invalid_signature" | "malformed_payload" | "gateway_unavailable";

export interface PaymentGateway {
  readonly provider: PaymentProviderName;
  createPix(input: CreatePixInput): Promise<UseCaseResult<CreatePixResult, "gateway_rejected" | "gateway_unavailable">>;
  verifyWebhook(input: {
    rawBody: string;
    headers: Headers;
    url: string;
  }): Promise<UseCaseResult<VerifiedPaymentEvent, WebhookVerificationError>>;
}
