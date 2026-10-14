import type { CreatePixInput, CreatePixResponse } from "../../schemas/index.js";
import type { PaymentGateway } from "../ports/payment-gateway.js";
import type { DonationRepository, StoredCharge } from "../ports/donation-repository.js";
import type { UseCaseResult } from "../ports/result.js";

export interface CreatePixDeps {
  gateway: PaymentGateway;
  repo: DonationRepository;
}

type CreatePixError =
  | "idempotency_conflict"
  | "gateway_rejected"
  | "gateway_unavailable"
  | "donation_persistence_failed";

function toResponse(charge: StoredCharge): CreatePixResponse | null {
  if (!charge.pixCopyPaste || !charge.expiresAt) return null;
  return {
    chargeId: charge.chargeId,
    provider: charge.provider,
    pixCopyPaste: charge.pixCopyPaste,
    expiresAt: charge.expiresAt.toISOString(),
    amountCents: charge.amountCents,
  };
}

/**
 * Fluxo idempotente (§8.4): a `idempotencyKey` do cliente identifica a intenção de doação.
 * - Retentativa com a mesma chave devolve a cobrança já emitida, sem nova chamada ao gateway.
 * - Mesma chave com valor/frequência diferentes é rejeitada (`idempotency_conflict`).
 * - A chave da intenção é repassada ao gateway para impedir cobrança duplicada no provedor.
 */
export async function createPixCharge(
  input: CreatePixInput,
  idempotencyKey: string,
  deps: CreatePixDeps
): Promise<UseCaseResult<CreatePixResponse, CreatePixError>> {
  let intent;
  try {
    intent = await deps.repo.findOrCreateIntent({
      idempotencyKey,
      amountCents: input.amountCents,
      frequency: input.frequency,
      donorEmail: input.donorEmail,
    });
  } catch {
    return { ok: false, kind: "infrastructure", error: "donation_persistence_failed", retryable: true };
  }

  if (intent.amountCents !== input.amountCents || intent.frequency !== input.frequency) {
    return {
      ok: false,
      kind: "expected",
      error: "idempotency_conflict",
      message: "Esta chave de idempotência já foi usada para outra doação.",
    };
  }

  if (intent.existingCharge) {
    const replay = toResponse(intent.existingCharge);
    if (replay) return { ok: true, value: replay };
  }

  const description =
    input.frequency === "monthly"
      ? "Doação mensal — Pure Life Ministries Brasil"
      : "Doação — Pure Life Ministries Brasil";

  const created = await deps.gateway.createPix({
    amountCents: intent.amountCents,
    description,
    donorEmail: input.donorEmail,
    idempotencyKey,
    externalReference: intent.intentId,
  });
  if (!created.ok) return created;

  let stored: StoredCharge;
  try {
    stored = await deps.repo.saveFirstCharge({
      intentId: intent.intentId,
      provider: deps.gateway.provider,
      providerChargeId: created.value.providerChargeId,
      amountCents: intent.amountCents,
      pixCopyPaste: created.value.pixCopyPaste,
      expiresAt: new Date(created.value.expiresAt),
    });
  } catch {
    return { ok: false, kind: "infrastructure", error: "donation_persistence_failed", retryable: true };
  }

  const response = toResponse(stored);
  if (!response) {
    return { ok: false, kind: "infrastructure", error: "donation_persistence_failed", retryable: true };
  }
  return { ok: true, value: response };
}
