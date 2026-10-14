import type { VerifiedPaymentEvent } from "../ports/payment-gateway.js";
import type { ChargeRepository } from "../ports/donation-repository.js";
import type { UseCaseResult } from "../ports/result.js";
import { canTransition, type ChargeStatus } from "../../domains/donations/state-machine.js";

export type { ChargeRepository } from "../ports/donation-repository.js";

export interface ProcessPaymentDeps {
  chargeRepo: ChargeRepository;
  now?: () => Date;
}

/**
 * - `processed`: estado aplicado (ou já era o alvo).
 * - `ignored`: evento definitivo que NÃO deve ser reprocessado (sem retry do gateway):
 *   tipo não suportado, divergência de valor (vai para conciliação manual) ou transição
 *   proibida — p.ex. `confirmed → failed`, que regrediria uma doação paga.
 */
export type PaymentEventOutcome =
  | { disposition: "processed"; chargeId: string; status: ChargeStatus }
  | {
      disposition: "ignored";
      chargeId: string | null;
      reason: "unsupported_event" | "amount_mismatch" | "invalid_transition";
    };

/** Erros transitórios: o gateway deve reenviar (o lease de idempotência retoma o evento). */
export type PaymentEventError = "charge_not_found" | "concurrent_update";

const TARGET_STATUS: Partial<Record<VerifiedPaymentEvent["eventType"], ChargeStatus>> = {
  "payment.confirmed": "confirmed",
  "payment.failed": "failed",
  "payment.expired": "expired",
  "payment.cancelled": "cancelled",
  "payment.refunded": "refunded",
};

export async function processPaymentEvent(
  event: VerifiedPaymentEvent,
  deps: ProcessPaymentDeps
): Promise<UseCaseResult<PaymentEventOutcome, PaymentEventError>> {
  const targetStatus = TARGET_STATUS[event.eventType];
  if (!targetStatus) {
    return { ok: true, value: { disposition: "ignored", chargeId: null, reason: "unsupported_event" } };
  }

  const charge = await deps.chargeRepo.findByProviderChargeId(event.provider, event.providerChargeId);
  if (!charge) {
    // Pode ser corrida (webhook antes do commit da cobrança): transitório, permite retry.
    return {
      ok: false,
      kind: "expected",
      error: "charge_not_found",
      message: "Cobrança não encontrada.",
    };
  }

  // Divergência de valor (§8.4): não altera estado e registra auditoria para conciliação manual.
  // Estornos podem ser parciais; a verificação vale para eventos que creditam a doação.
  if (targetStatus === "confirmed" && charge.amountCents !== event.amountCents) {
    await deps.chargeRepo.recordAudit("charge.amount_mismatch", charge.id, {
      expectedCents: charge.amountCents,
      receivedCents: event.amountCents,
      provider: event.provider,
      eventId: event.eventId,
    });
    return { ok: true, value: { disposition: "ignored", chargeId: charge.id, reason: "amount_mismatch" } };
  }

  if (charge.status === targetStatus) {
    return { ok: true, value: { disposition: "processed", chargeId: charge.id, status: charge.status } };
  }

  if (!canTransition(charge.status, targetStatus)) {
    await deps.chargeRepo.recordAudit("charge.transition_rejected", charge.id, {
      from: charge.status,
      to: targetStatus,
      provider: event.provider,
      eventId: event.eventId,
    });
    return { ok: true, value: { disposition: "ignored", chargeId: charge.id, reason: "invalid_transition" } };
  }

  const applied = await deps.chargeRepo.transitionStatus(
    charge.id,
    charge.status,
    targetStatus,
    deps.now?.() ?? new Date()
  );
  if (!applied) {
    return {
      ok: false,
      kind: "expected",
      error: "concurrent_update",
      message: "Estado da cobrança alterado concorrentemente.",
    };
  }

  return { ok: true, value: { disposition: "processed", chargeId: charge.id, status: targetStatus } };
}
