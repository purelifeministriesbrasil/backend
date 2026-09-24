import type { PaymentGateway } from "../../application/ports/payment-gateway.js";
import type { EventIdempotencyRepository } from "../../application/ports/idempotency-repository.js";
import { assertBodySize } from "../../infrastructure/security/request-guards.js";
import {
  processPaymentEvent,
  type ChargeRepository,
} from "../../application/usecases/process-payment-event.js";

export interface WebhookDeps {
  gateway: PaymentGateway;
  idempotency: EventIdempotencyRepository;
  chargeRepo: ChargeRepository;
  clock: { now: () => Date };
}

export async function handlePaymentWebhook(
  request: Request,
  deps: WebhookDeps
): Promise<Response> {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };

  const rawBody = await request.text();
  if (!assertBodySize(rawBody, 64_000)) {
    return new Response(null, { status: 413 });
  }

  const verified = await deps.gateway.verifyWebhook({
    rawBody,
    headers: request.headers,
  });

  if (!verified.ok) {
    // 400, não 500: assinatura inválida não é falha temporária e não deve gerar retry pelo gateway
    return new Response(JSON.stringify({ error: "invalid_signature" }), {
      status: 400,
      headers,
    });
  }

  const claim = await deps.idempotency.claimOrResume({
    provider: verified.value.provider,
    eventId: verified.value.eventId,
    eventType: verified.value.eventType,
    signatureOk: true,
    now: deps.clock.now(),
    leaseSeconds: 60,
    maxAttempts: 5,
  });

  if (claim.kind === "already_processed") return new Response(null, { status: 204 });
  if (claim.kind === "currently_processing") return new Response(null, { status: 409 });
  if (claim.kind === "dead_letter") return new Response(null, { status: 204 });

  const result = await processPaymentEvent(verified.value, {
    chargeRepo: deps.chargeRepo,
  });

  if (!result.ok) {
    await deps.idempotency.markFailed(
      verified.value.provider,
      verified.value.eventId,
      result.error
    );
    // 500 faz o gateway reenviar; o reenvio retoma graças ao modelo de lease
    return new Response(JSON.stringify({ error: "processing_failed" }), {
      status: 500,
      headers,
    });
  }

  await deps.idempotency.markProcessed(
    verified.value.provider,
    verified.value.eventId,
    result.value.chargeId
  );

  return new Response(null, { status: 204 });
}
