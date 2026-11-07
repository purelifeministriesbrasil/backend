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
 * - Antes de criar a cobrança no provedor, obtém um bloqueio por intenção: duas requisições concorrentes
 *   com a mesma chave não criam duas cobranças; a que espera encontra a cobrança gravada pela primeira.
 * - Prevenção de duplicidade no provedor depende do gateway: o Mercado Pago recebe `idempotencyKey`
 *   como header; o Asaas concilia por `externalReference` (id da intenção) antes de criar.
 * - Falha ANTES de existir cobrança remota não deixa rastro; falha DEPOIS (ex.: ao gravar localmente) é
 *   resolvida na retentativa, pois o gateway reencontra a cobrança já criada.
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

  try {
    return await deps.repo.withCreationLock(intent.intentId, async (repo) => {
      // Reavalia sob o bloqueio: outra requisição pode ter gravado a cobrança enquanto esta esperava.
      const current = await repo.findFirstCharge(intent.intentId);
      const replay = current ? toResponse(current) : null;
      if (replay) return { ok: true as const, value: replay };

      const created = await deps.gateway.createPix({
        amountCents: intent.amountCents,
        description,
        donorEmail: input.donorEmail,
        idempotencyKey,
        externalReference: intent.intentId,
      });
      if (!created.ok) return created;

      const stored = await repo.saveFirstCharge({
        intentId: intent.intentId,
        provider: deps.gateway.provider,
        providerChargeId: created.value.providerChargeId,
        amountCents: intent.amountCents,
        pixCopyPaste: created.value.pixCopyPaste,
        expiresAt: new Date(created.value.expiresAt),
      });
      const response = toResponse(stored);
      if (!response) throw new Error("charge_without_pix_payload");
      return { ok: true as const, value: response };
    });
  } catch {
    return { ok: false, kind: "infrastructure", error: "donation_persistence_failed", retryable: true };
  }
}
