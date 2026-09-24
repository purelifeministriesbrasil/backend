import type { UseCaseResult } from "./result.js";

export interface CreatePixInput {
  amountCents: number;
  frequency: "one_time" | "monthly";
  donorEmail?: string;
  idempotencyKey: string; // Chave para evitar cobrança duplicada no provedor
}

/** Sem imagem base64: a ilha cliente gera o QR localmente a partir do payload (§7.1). */
export interface CreatePixResult {
  providerChargeId: string;
  pixCopyPaste: string;
  expiresAt: string; // ISO 8601
}

export type VerifiedPaymentEvent = {
  provider: "asaas" | "mercadopago";
  eventId: string;
  eventType: "payment.confirmed" | "payment.failed" | "payment.refunded" | "unknown";
  providerChargeId: string;
  amountCents: number;
  occurredAt: string;
};

export interface PaymentGateway {
  createPix(input: CreatePixInput): Promise<UseCaseResult<CreatePixResult, "gateway_rejected" | "gateway_unavailable">>;
  verifyWebhook(input: { rawBody: string; headers: Headers }): Promise<UseCaseResult<VerifiedPaymentEvent, "invalid_signature" | "malformed_payload">>;
}
