import type { CreatePixInput } from "../../schemas/index.js";
import type { PaymentGateway, CreatePixResult } from "../ports/payment-gateway.js";
import type { UseCaseResult } from "../ports/result.js";

export interface CreatePixDeps {
  gateway: PaymentGateway;
}

export async function createPixCharge(
  input: CreatePixInput,
  deps: CreatePixDeps
): Promise<UseCaseResult<CreatePixResult, "gateway_rejected" | "gateway_unavailable">> {
  const idempotencyKey = `pix_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return deps.gateway.createPix({
    amountCents: input.amountCents,
    frequency: input.frequency,
    donorEmail: input.donorEmail,
    idempotencyKey,
  });
}
