import { describe, it, expect, vi } from "vitest";
import { handleCreatePix } from "../src/presentation/donations/create-pix.js";
import type { DonationRepository, StoredCharge } from "../src/application/ports/donation-repository.js";
import type { PaymentGateway } from "../src/application/ports/payment-gateway.js";
import { createPixResponseSchema } from "../src/schemas/index.js";
import { SITE, failTurnstile, jsonRequest, passTurnstile } from "./helpers.js";

function inMemoryDonations(): DonationRepository & { intents: Map<string, { id: string; amountCents: number; frequency: "one_time" | "monthly" }>; charges: Map<string, StoredCharge> } {
  const intents = new Map<string, { id: string; amountCents: number; frequency: "one_time" | "monthly" }>();
  const charges = new Map<string, StoredCharge>();
  return {
    intents,
    charges,
    findOrCreateIntent: vi.fn(async ({ idempotencyKey, amountCents, frequency }) => {
      const existing = intents.get(idempotencyKey);
      if (existing) {
        return { intentId: existing.id, amountCents: existing.amountCents, frequency: existing.frequency, created: false, existingCharge: charges.get(existing.id) ?? null };
      }
      const id = crypto.randomUUID();
      intents.set(idempotencyKey, { id, amountCents, frequency });
      return { intentId: id, amountCents, frequency, created: true, existingCharge: null };
    }),
    saveFirstCharge: vi.fn(async (input) => {
      const existing = charges.get(input.intentId);
      if (existing) return existing;
      const charge: StoredCharge = {
        chargeId: crypto.randomUUID(),
        provider: input.provider,
        providerChargeId: input.providerChargeId,
        amountCents: input.amountCents,
        status: "pending",
        pixCopyPaste: input.pixCopyPaste,
        expiresAt: input.expiresAt,
      };
      charges.set(input.intentId, charge);
      return charge;
    }),
  };
}

function fakeGateway(result: "ok" | "unavailable" | "rejected" = "ok") {
  const gateway = {
    provider: "asaas" as const,
    createPix: vi.fn(async () =>
      result === "ok"
        ? {
            ok: true as const,
            value: {
              providerChargeId: `pay_${crypto.randomUUID()}`,
              pixCopyPaste: "00020101021226800014br.gov.bcb.pix2558pix.example/qr/v2/abc5204000053039865802BR6304ABCD",
              expiresAt: "2026-10-14T03:00:00.000Z",
            },
          }
        : { ok: false as const, kind: "infrastructure" as const, error: result === "unavailable" ? ("gateway_unavailable" as const) : ("gateway_rejected" as const), retryable: result === "unavailable" }
    ),
    verifyWebhook: vi.fn(),
  };
  return gateway as typeof gateway & PaymentGateway;
}

const env = { PUBLIC_SITE_ORIGIN: SITE };
const body = { amountCents: 5000, frequency: "one_time", donorEmail: "Doador@Example.com", turnstileToken: "token-turnstile-valido" };

describe("POST /api/donations/create-pix (ponta a ponta com portas simuladas)", () => {
  it("creates the intent, calls the gateway with the idempotency key and returns the Pix payload", async () => {
    const repo = inMemoryDonations();
    const gateway = fakeGateway();
    const key = crypto.randomUUID();
    const res = await handleCreatePix(jsonRequest("/api/donations/create-pix", body, { "Idempotency-Key": key }), env, {
      turnstile: passTurnstile,
      donations: () => ({ gateway, repo }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const parsed = createPixResponseSchema.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    expect(gateway.createPix).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 5000, idempotencyKey: key, donorEmail: "doador@example.com" })
    );
  });

  it("replays the same charge for a retried request (double click) without charging twice", async () => {
    const repo = inMemoryDonations();
    const gateway = fakeGateway();
    const key = crypto.randomUUID();
    const deps = { turnstile: passTurnstile, donations: () => ({ gateway, repo }) };

    const first = await (await handleCreatePix(jsonRequest("/api/donations/create-pix", body, { "Idempotency-Key": key }), env, deps)).json();
    const second = await (await handleCreatePix(jsonRequest("/api/donations/create-pix", body, { "Idempotency-Key": key }), env, deps)).json();

    expect(second).toEqual(first);
    expect(gateway.createPix).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when the same idempotency key is reused for a different amount", async () => {
    const repo = inMemoryDonations();
    const gateway = fakeGateway();
    const key = crypto.randomUUID();
    const deps = { turnstile: passTurnstile, donations: () => ({ gateway, repo }) };

    await handleCreatePix(jsonRequest("/api/donations/create-pix", body, { "Idempotency-Key": key }), env, deps);
    const res = await handleCreatePix(jsonRequest("/api/donations/create-pix", { ...body, amountCents: 9000 }, { "Idempotency-Key": key }), env, deps);
    expect(res.status).toBe(409);
    expect(gateway.createPix).toHaveBeenCalledTimes(1);
  });

  it("maps gateway outages to 503 and rejections to 502 with user-facing messages", async () => {
    for (const [mode, status] of [["unavailable", 503], ["rejected", 502]] as const) {
      const res = await handleCreatePix(jsonRequest("/api/donations/create-pix", body, { "Idempotency-Key": crypto.randomUUID() }), env, {
        turnstile: passTurnstile,
        donations: () => ({ gateway: fakeGateway(mode), repo: inMemoryDonations() }),
      });
      expect(res.status).toBe(status);
      expect(((await res.json()) as { message: string }).message).toBeTruthy();
    }
  });

  it("validates amount bounds (422) before Turnstile and gateway", async () => {
    const gateway = fakeGateway();
    const turnstile = { verify: vi.fn(async () => true) };
    const res = await handleCreatePix(jsonRequest("/api/donations/create-pix", { ...body, amountCents: 499 }, { "Idempotency-Key": crypto.randomUUID() }), env, {
      turnstile,
      donations: () => ({ gateway, repo: inMemoryDonations() }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { fields: Record<string, string> }).fields.amountCents).toBe("Valor mínimo de R$ 5,00.");
    expect(turnstile.verify).not.toHaveBeenCalled();
    expect(gateway.createPix).not.toHaveBeenCalled();
  });

  it("requires the Idempotency-Key header", async () => {
    const res = await handleCreatePix(jsonRequest("/api/donations/create-pix", body), env, {
      turnstile: passTurnstile,
      donations: () => ({ gateway: fakeGateway(), repo: inMemoryDonations() }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 when Turnstile fails and never reaches the gateway", async () => {
    const gateway = fakeGateway();
    const res = await handleCreatePix(jsonRequest("/api/donations/create-pix", body, { "Idempotency-Key": crypto.randomUUID() }), env, {
      turnstile: failTurnstile,
      donations: () => ({ gateway, repo: inMemoryDonations() }),
    });
    expect(res.status).toBe(403);
    expect(gateway.createPix).not.toHaveBeenCalled();
  });
});
