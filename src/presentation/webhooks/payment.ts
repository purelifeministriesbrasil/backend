import type { PaymentGateway } from "../../application/ports/payment-gateway.js";
import type { EventIdempotencyRepository } from "../../application/ports/idempotency-repository.js";
import { assertBodySize, exceedsDeclaredLength } from "../../infrastructure/security/request-guards.js";
import { log } from "../../infrastructure/observability/logger.js";
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

const MAX_BYTES = 64_000;
const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

/** Asaas e Mercado Pago tratam 200 como entrega concluída (2xx diferente pode gerar reenvio). */
const ack = (body: Record<string, unknown> = { received: true }) =>
  new Response(JSON.stringify(body), { status: 200, headers: HEADERS });

export async function handlePaymentWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }
  if (exceedsDeclaredLength(request, MAX_BYTES)) {
    return new Response(null, { status: 413 });
  }

  const rawBody = await request.text();
  if (!assertBodySize(rawBody, MAX_BYTES)) {
    return new Response(null, { status: 413 });
  }

  const verified = await deps.gateway.verifyWebhook({ rawBody, headers: request.headers, url: request.url });

  if (!verified.ok) {
    if (verified.error === "gateway_unavailable") {
      // Não conseguimos consultar o provedor: 503 provoca reenvio posterior.
      return new Response(JSON.stringify({ error: "upstream_unavailable" }), { status: 503, headers: HEADERS });
    }
    log("warn", "webhook.rejected", { provider: deps.gateway.provider, reason: verified.error });
    // 400, não 500: assinatura inválida não é falha temporária e não deve gerar retry pelo gateway
    return new Response(JSON.stringify({ error: verified.error }), { status: 400, headers: HEADERS });
  }

  const event = verified.value;
  const claim = await deps.idempotency.claimOrResume({
    provider: event.provider,
    eventId: event.eventId,
    eventType: event.eventType,
    signatureOk: true,
    now: deps.clock.now(),
    leaseSeconds: 60,
    maxAttempts: 5,
  });

  if (claim.kind === "already_processed") return ack({ received: true, duplicate: true });
  if (claim.kind === "currently_processing") return new Response(null, { status: 409 });
  if (claim.kind === "dead_letter") {
    log("error", "webhook.dead_letter", { provider: event.provider, eventId: event.eventId });
    return ack({ received: true });
  }

  let result;
  try {
    result = await processPaymentEvent(event, { chargeRepo: deps.chargeRepo, now: deps.clock.now });
  } catch (err) {
    await deps.idempotency.markFailed(event.provider, event.eventId, "processing_exception");
    throw err;
  }

  if (!result.ok) {
    await deps.idempotency.markFailed(event.provider, event.eventId, result.error);
    // 500 faz o gateway reenviar; o reenvio retoma graças ao modelo de lease
    return new Response(JSON.stringify({ error: "processing_failed" }), { status: 500, headers: HEADERS });
  }

  const outcome = result.value;
  if (outcome.disposition === "ignored") {
    await deps.idempotency.markIgnored(event.provider, event.eventId, outcome.reason);
    if (outcome.reason !== "unsupported_event") {
      log("warn", "webhook.event_ignored", { provider: event.provider, eventId: event.eventId, reason: outcome.reason });
    }
    return ack();
  }

  await deps.idempotency.markProcessed(event.provider, event.eventId, outcome.chargeId);
  return ack();
}
