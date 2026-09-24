import type { VerifiedPaymentEvent } from "../ports/payment-gateway.js";
import type { UseCaseResult } from "../ports/result.js";
import { canTransition, type ChargeStatus } from "../../domains/donations/state-machine.js";

export interface ChargeRepository {
  findByProviderChargeId(
    provider: string,
    providerChargeId: string
  ): Promise<{ id: string; status: ChargeStatus; amountCents: number } | null>;
  updateStatus(chargeId: string, status: ChargeStatus): Promise<void>;
  recordAudit(action: string, entityId: string, metadata: Record<string, unknown>): Promise<void>;
}

export interface ProcessPaymentDeps {
  chargeRepo: ChargeRepository;
}

export async function processPaymentEvent(
  event: VerifiedPaymentEvent,
  deps: ProcessPaymentDeps
): Promise<UseCaseResult<{ chargeId: string; status: ChargeStatus }>> {
  const charge = await deps.chargeRepo.findByProviderChargeId(event.provider, event.providerChargeId);

  if (!charge) {
    return {
      ok: false,
      kind: "expected",
      error: "charge_not_found",
      message: `Cobrança ${event.providerChargeId} não encontrada.`,
    };
  }

  // Divergência de valor (§8.4): não altera estado e registra auditoria para conciliação manual
  if (charge.amountCents !== event.amountCents) {
    await deps.chargeRepo.recordAudit("charge.amount_mismatch", charge.id, {
      expectedCents: charge.amountCents,
      receivedCents: event.amountCents,
      provider: event.provider,
    });
    return {
      ok: false,
      kind: "expected",
      error: "amount_mismatch",
      message: "Divergência entre o valor pago e o registrado.",
    };
  }

  let targetStatus: ChargeStatus;
  switch (event.eventType) {
    case "payment.confirmed":
      targetStatus = "confirmed";
      break;
    case "payment.failed":
      targetStatus = "failed";
      break;
    case "payment.refunded":
      targetStatus = "refunded";
      break;
    default:
      return {
        ok: true,
        value: { chargeId: charge.id, status: charge.status },
      };
  }

  if (charge.status === targetStatus) {
    return {
      ok: true,
      value: { chargeId: charge.id, status: charge.status },
    };
  }

  if (!canTransition(charge.status, targetStatus)) {
    return {
      ok: false,
      kind: "expected",
      error: "invalid_transition",
      message: `Transição inválida de ${charge.status} para ${targetStatus}.`,
    };
  }

  await deps.chargeRepo.updateStatus(charge.id, targetStatus);

  return {
    ok: true,
    value: { chargeId: charge.id, status: targetStatus },
  };
}
