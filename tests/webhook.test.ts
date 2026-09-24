import { describe, it, expect, vi } from "vitest";
import { handlePaymentWebhook, type WebhookDeps } from "../src/presentation/webhooks/payment.js";

describe("Webhook Processing & Idempotency Lease (§8.4, ADR-005)", () => {
  const dummyClock = { now: () => new Date("2026-09-24T12:00:00Z") };

  const createMockDeps = (overrides?: Partial<WebhookDeps>): WebhookDeps => ({
    gateway: {
      verifyWebhook: vi.fn(async () => ({
        ok: true,
        value: {
          provider: "asaas" as const,
          eventId: "evt_123456",
          eventType: "payment.confirmed" as const,
          providerChargeId: "chg_999",
          amountCents: 5000,
          occurredAt: "2026-09-24T12:00:00Z",
        },
      })),
      createCharge: vi.fn(),
    } as any,
    idempotency: {
      claimOrResume: vi.fn(async () => ({ kind: "claimed" as const })),
      markProcessed: vi.fn(async () => {}),
      markIgnored: vi.fn(async () => {}),
      markFailed: vi.fn(async () => {}),
    },
    chargeRepo: {
      findByProviderChargeId: vi.fn(async () => ({
        id: "local_chg_01",
        status: "pending" as const,
        amountCents: 5000,
      })),
      updateStatus: vi.fn(async () => {}),
      recordAudit: vi.fn(async () => {}),
    },
    clock: dummyClock,
    ...overrides,
  });

  it("returns 413 when webhook payload exceeds 64KB boundary", async () => {
    const hugeBody = "x".repeat(65_000);
    const req = new Request("https://purelifebrasil.org/api/webhooks/asaas", {
      method: "POST",
      body: hugeBody,
    });

    const deps = createMockDeps();
    const res = await handlePaymentWebhook(req, deps);

    expect(res.status).toBe(413);
    expect(deps.gateway.verifyWebhook).not.toHaveBeenCalled();
  });

  it("returns 400 when webhook signature verification fails", async () => {
    const deps = createMockDeps({
      gateway: {
        verifyWebhook: vi.fn(async () => ({
          ok: false,
          error: "invalid_signature",
        })),
        createCharge: vi.fn(),
      } as any,
    });

    const req = new Request("https://purelifebrasil.org/api/webhooks/asaas", {
      method: "POST",
      body: JSON.stringify({ event: "PAYMENT_CONFIRMED" }),
    });

    const res = await handlePaymentWebhook(req, deps);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toEqual({ error: "invalid_signature" });
    expect(deps.idempotency.claimOrResume).not.toHaveBeenCalled();
  });

  it("returns 204 immediately when event was already processed (deduplication)", async () => {
    const deps = createMockDeps({
      idempotency: {
        claimOrResume: vi.fn(async () => ({ kind: "already_processed" })),
        markProcessed: vi.fn(),
        markIgnored: vi.fn(),
        markFailed: vi.fn(),
      },
    });

    const req = new Request("https://purelifebrasil.org/api/webhooks/asaas", {
      method: "POST",
      body: JSON.stringify({ event: "PAYMENT_CONFIRMED" }),
    });

    const res = await handlePaymentWebhook(req, deps);
    expect(res.status).toBe(204);
    expect(deps.chargeRepo.findByProviderChargeId).not.toHaveBeenCalled();
  });

  it("returns 409 Conflict when another worker holds an active lease (concurrency lock)", async () => {
    const deps = createMockDeps({
      idempotency: {
        claimOrResume: vi.fn(async () => ({ kind: "currently_processing" })),
        markProcessed: vi.fn(),
        markIgnored: vi.fn(),
        markFailed: vi.fn(),
      },
    });

    const req = new Request("https://purelifebrasil.org/api/webhooks/asaas", {
      method: "POST",
      body: JSON.stringify({ event: "PAYMENT_CONFIRMED" }),
    });

    const res = await handlePaymentWebhook(req, deps);
    expect(res.status).toBe(409);
    expect(deps.chargeRepo.findByProviderChargeId).not.toHaveBeenCalled();
  });

  it("returns 204 when event reached max retry attempts and is in dead letter state", async () => {
    const deps = createMockDeps({
      idempotency: {
        claimOrResume: vi.fn(async () => ({ kind: "dead_letter" })),
        markProcessed: vi.fn(),
        markIgnored: vi.fn(),
        markFailed: vi.fn(),
      },
    });

    const req = new Request("https://purelifebrasil.org/api/webhooks/asaas", {
      method: "POST",
      body: JSON.stringify({ event: "PAYMENT_CONFIRMED" }),
    });

    const res = await handlePaymentWebhook(req, deps);
    expect(res.status).toBe(204);
  });

  it("successfully processes valid payment event, updates charge, and marks processed", async () => {
    const deps = createMockDeps();

    const req = new Request("https://purelifebrasil.org/api/webhooks/asaas", {
      method: "POST",
      body: JSON.stringify({ event: "PAYMENT_RECEIVED", id: "pay_1" }),
    });

    const res = await handlePaymentWebhook(req, deps);
    expect(res.status).toBe(204);

    expect(deps.idempotency.claimOrResume).toHaveBeenCalledTimes(1);
    expect(deps.chargeRepo.findByProviderChargeId).toHaveBeenCalledWith("asaas", "chg_999");
    expect(deps.chargeRepo.updateStatus).toHaveBeenCalledWith("local_chg_01", "confirmed");
    expect(deps.idempotency.markProcessed).toHaveBeenCalledWith("asaas", "evt_123456", "local_chg_01");
  });

  it("returns 500 and logs audit mismatch when paid amount diverges from registered charge", async () => {
    const deps = createMockDeps({
      gateway: {
        verifyWebhook: vi.fn(async () => ({
          ok: true,
          value: {
            provider: "asaas" as const,
            eventId: "evt_divergent_1",
            eventType: "payment.confirmed" as const,
            providerChargeId: "chg_999",
            amountCents: 9999, // Divergente de 5000
            occurredAt: "2026-09-24T12:00:00Z",
          },
        })),
        createCharge: vi.fn(),
      } as any,
    });

    const req = new Request("https://purelifebrasil.org/api/webhooks/asaas", {
      method: "POST",
      body: JSON.stringify({ event: "PAYMENT_RECEIVED", id: "pay_divergent" }),
    });

    const res = await handlePaymentWebhook(req, deps);
    expect(res.status).toBe(500);

    expect(deps.chargeRepo.recordAudit).toHaveBeenCalledWith(
      "charge.amount_mismatch",
      "local_chg_01",
      expect.objectContaining({
        expectedCents: 5000,
        receivedCents: 9999,
      })
    );
    expect(deps.chargeRepo.updateStatus).not.toHaveBeenCalled();
    expect(deps.idempotency.markFailed).toHaveBeenCalledWith(
      "asaas",
      "evt_divergent_1",
      "amount_mismatch"
    );
  });
});
