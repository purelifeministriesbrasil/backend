import { describe, it, expect, vi } from "vitest";
import { handlePaymentWebhook, type WebhookDeps } from "../src/presentation/webhooks/payment.js";
import type { VerifiedPaymentEvent } from "../src/application/ports/payment-gateway.js";
import type { ChargeStatus } from "../src/domains/donations/state-machine.js";

describe("Webhook Processing & Idempotency Lease (§8.4, ADR-005)", () => {
  const dummyClock = { now: () => new Date("2026-09-24T12:00:00Z") };

  const event = (overrides: Partial<VerifiedPaymentEvent> = {}): VerifiedPaymentEvent => ({
    provider: "asaas",
    eventId: "evt_123456",
    eventType: "payment.confirmed",
    providerChargeId: "chg_999",
    amountCents: 5000,
    occurredAt: "2026-09-24T12:00:00Z",
    ...overrides,
  });

  const createMockDeps = (
    opts: { event?: VerifiedPaymentEvent; status?: ChargeStatus; claim?: string; verifyFails?: string } = {}
  ) => {
    const deps = {
      gateway: {
        provider: "asaas" as const,
        createPix: vi.fn(),
        verifyWebhook: vi.fn(async () =>
          opts.verifyFails
            ? { ok: false as const, kind: "expected" as const, error: opts.verifyFails, message: "x" }
            : { ok: true as const, value: opts.event ?? event() }
        ),
      },
      idempotency: {
        claimOrResume: vi.fn(async () => ({ kind: opts.claim ?? "claimed" })),
        markProcessed: vi.fn(async () => {}),
        markIgnored: vi.fn(async () => {}),
        markFailed: vi.fn(async () => {}),
      },
      chargeRepo: {
        findByProviderChargeId: vi.fn(async () => ({
          id: "local_chg_01",
          status: opts.status ?? ("pending" as ChargeStatus),
          amountCents: 5000,
        })),
        transitionStatus: vi.fn(async () => true),
        recordAudit: vi.fn(async () => {}),
      },
      clock: dummyClock,
    };
    return deps as typeof deps & WebhookDeps;
  };

  const post = (body: string = JSON.stringify({ event: "PAYMENT_RECEIVED" })) =>
    new Request("https://api.purelifeministriesbrasil.org/api/webhooks/payment", { method: "POST", body });

  it("returns 413 when webhook payload exceeds 64KB boundary", async () => {
    const deps = createMockDeps();
    const res = await handlePaymentWebhook(post("x".repeat(65_000)), deps);
    expect(res.status).toBe(413);
    expect(deps.gateway.verifyWebhook).not.toHaveBeenCalled();
  });

  it("returns 400 when webhook signature verification fails, without touching idempotency", async () => {
    const deps = createMockDeps({ verifyFails: "invalid_signature" });
    const res = await handlePaymentWebhook(post(), deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_signature" });
    expect(deps.idempotency.claimOrResume).not.toHaveBeenCalled();
  });

  it("returns 503 (retry) when the provider cannot be queried during verification", async () => {
    const deps = createMockDeps({ verifyFails: "gateway_unavailable" });
    const res = await handlePaymentWebhook(post(), deps);
    expect(res.status).toBe(503);
  });

  it("acknowledges with 200 when event was already processed (deduplication)", async () => {
    const deps = createMockDeps({ claim: "already_processed" });
    const res = await handlePaymentWebhook(post(), deps);
    expect(res.status).toBe(200);
    expect(deps.chargeRepo.findByProviderChargeId).not.toHaveBeenCalled();
  });

  it("returns 409 Conflict when another worker holds an active lease (concurrency lock)", async () => {
    const deps = createMockDeps({ claim: "currently_processing" });
    const res = await handlePaymentWebhook(post(), deps);
    expect(res.status).toBe(409);
    expect(deps.chargeRepo.findByProviderChargeId).not.toHaveBeenCalled();
  });

  it("acknowledges dead-lettered events so the provider stops retrying", async () => {
    const deps = createMockDeps({ claim: "dead_letter" });
    const res = await handlePaymentWebhook(post(), deps);
    expect(res.status).toBe(200);
  });

  it("processes a valid payment event, transitions the charge conditionally and marks processed", async () => {
    const deps = createMockDeps();
    const res = await handlePaymentWebhook(post(), deps);
    expect(res.status).toBe(200);
    expect(deps.chargeRepo.findByProviderChargeId).toHaveBeenCalledWith("asaas", "chg_999");
    expect(deps.chargeRepo.transitionStatus).toHaveBeenCalledWith("local_chg_01", "pending", "confirmed", expect.any(Date));
    expect(deps.idempotency.markProcessed).toHaveBeenCalledWith("asaas", "evt_123456", "local_chg_01");
  });

  it("ignores (no retry) and audits when the paid amount diverges from the registered charge", async () => {
    const deps = createMockDeps({ event: event({ eventId: "evt_divergent_1", amountCents: 9999 }) });
    const res = await handlePaymentWebhook(post(), deps);

    expect(res.status).toBe(200);
    expect(deps.chargeRepo.recordAudit).toHaveBeenCalledWith(
      "charge.amount_mismatch",
      "local_chg_01",
      expect.objectContaining({ expectedCents: 5000, receivedCents: 9999 })
    );
    expect(deps.chargeRepo.transitionStatus).not.toHaveBeenCalled();
    expect(deps.idempotency.markIgnored).toHaveBeenCalledWith("asaas", "evt_divergent_1", "amount_mismatch");
  });

  it("never regresses a confirmed donation to failed (state machine guard)", async () => {
    const deps = createMockDeps({ status: "confirmed", event: event({ eventType: "payment.failed" }) });
    const res = await handlePaymentWebhook(post(), deps);

    expect(res.status).toBe(200);
    expect(deps.chargeRepo.transitionStatus).not.toHaveBeenCalled();
    expect(deps.idempotency.markIgnored).toHaveBeenCalledWith("asaas", "evt_123456", "invalid_transition");
    expect(deps.chargeRepo.recordAudit).toHaveBeenCalledWith(
      "charge.transition_rejected",
      "local_chg_01",
      expect.objectContaining({ from: "confirmed", to: "failed" })
    );
  });

  it("never regresses a confirmed donation to expired (late OVERDUE event)", async () => {
    const deps = createMockDeps({ status: "confirmed", event: event({ eventType: "payment.expired" }) });
    await handlePaymentWebhook(post(), deps);
    expect(deps.chargeRepo.transitionStatus).not.toHaveBeenCalled();
  });

  it("treats a duplicate confirmation of an already confirmed charge as processed (idempotent no-op)", async () => {
    const deps = createMockDeps({ status: "confirmed" });
    const res = await handlePaymentWebhook(post(), deps);
    expect(res.status).toBe(200);
    expect(deps.chargeRepo.transitionStatus).not.toHaveBeenCalled();
    expect(deps.idempotency.markProcessed).toHaveBeenCalled();
  });

  it("returns 500 (retry) when the charge is not found yet (race with charge creation)", async () => {
    const deps = createMockDeps();
    deps.chargeRepo.findByProviderChargeId.mockResolvedValueOnce(null as never);
    const res = await handlePaymentWebhook(post(), deps);
    expect(res.status).toBe(500);
    expect(deps.idempotency.markFailed).toHaveBeenCalledWith("asaas", "evt_123456", "charge_not_found");
  });

  it("returns 500 (retry) when the conditional transition loses a concurrent race", async () => {
    const deps = createMockDeps();
    deps.chargeRepo.transitionStatus.mockResolvedValueOnce(false);
    const res = await handlePaymentWebhook(post(), deps);
    expect(res.status).toBe(500);
    expect(deps.idempotency.markFailed).toHaveBeenCalledWith("asaas", "evt_123456", "concurrent_update");
  });

  it("ignores unsupported event types without querying charges", async () => {
    const deps = createMockDeps({ event: event({ eventType: "unknown" }) });
    const res = await handlePaymentWebhook(post(), deps);
    expect(res.status).toBe(200);
    expect(deps.chargeRepo.findByProviderChargeId).not.toHaveBeenCalled();
    expect(deps.idempotency.markIgnored).toHaveBeenCalledWith("asaas", "evt_123456", "unsupported_event");
  });
});
