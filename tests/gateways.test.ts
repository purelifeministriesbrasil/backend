import { describe, it, expect, vi, afterEach } from "vitest";
import { createAsaasGateway } from "../src/infrastructure/payments/asaas.js";
import { createMercadoPagoGateway } from "../src/infrastructure/payments/mercadopago.js";
import { hmacSha256Hex } from "../src/infrastructure/crypto/hashing.js";

type Call = { url: string; init: RequestInit };

function stubFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return responder(url, init);
    })
  );
  return calls;
}

const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("Asaas gateway", () => {
  const config = {
    apiKey: "asaas_key",
    webhookSecret: "whsec_asaas",
    donationCustomerId: "cus_123",
    apiBaseUrl: "https://api-sandbox.asaas.com/v3",
    pixExpirationMinutes: 60,
  };

  it("creates a PIX charge for the institutional customer and fetches the copy-paste payload", async () => {
    const calls = stubFetch((url) =>
      url.endsWith("/payments")
        ? jsonRes(200, { id: "pay_abc" })
        : jsonRes(200, { encodedImage: "iVBOR...", payload: "000201PIX", expirationDate: "2026-10-14 23:59:59" })
    );

    const result = await createAsaasGateway(config).createPix({
      amountCents: 5000,
      description: "Doação",
      idempotencyKey: crypto.randomUUID(),
      externalReference: "intent-1",
    });

    expect(result).toEqual({
      ok: true,
      value: { providerChargeId: "pay_abc", pixCopyPaste: "000201PIX", expiresAt: "2026-10-15T02:59:59.000Z" },
    });
    expect(calls[0].url).toBe("https://api-sandbox.asaas.com/v3/payments");
    expect((calls[0].init.headers as Record<string, string>).access_token).toBe("asaas_key");
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent).toMatchObject({ customer: "cus_123", billingType: "PIX", value: 50, externalReference: "intent-1" });
    expect(sent.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(calls[1].url).toBe("https://api-sandbox.asaas.com/v3/payments/pay_abc/pixQrCode");
  });

  it("maps 4xx to gateway_rejected and network failures to gateway_unavailable", async () => {
    stubFetch(() => jsonRes(400, { errors: [{ code: "invalid_customer" }] }));
    const rejected = await createAsaasGateway(config).createPix({ amountCents: 5000, description: "x", idempotencyKey: "k", externalReference: "r" });
    expect(rejected.ok === false && rejected.error).toBe("gateway_rejected");

    stubFetch(() => {
      throw new TypeError("network down");
    });
    const down = await createAsaasGateway(config).createPix({ amountCents: 5000, description: "x", idempotencyKey: "k", externalReference: "r" });
    expect(down.ok === false && down.error).toBe("gateway_unavailable");
  });

  const webhook = (token: string | null, body: unknown) =>
    createAsaasGateway(config).verifyWebhook({
      rawBody: JSON.stringify(body),
      headers: new Headers(token === null ? {} : { "asaas-access-token": token }),
      url: "https://api.purelifebrasil.org/api/webhooks/payment",
    });

  const asaasEvent = (event: string) => ({
    id: "evt_1",
    event,
    dateCreated: "2026-10-13 10:00:00",
    payment: { id: "pay_abc", value: 50, status: "RECEIVED" },
  });

  it("requires the webhook token (missing or wrong token is rejected)", async () => {
    expect((await webhook(null, asaasEvent("PAYMENT_RECEIVED"))).ok).toBe(false);
    expect((await webhook("whsec_asaaS", asaasEvent("PAYMENT_RECEIVED"))).ok).toBe(false);
  });

  it("maps Asaas events to domain events", async () => {
    const cases: [string, string][] = [
      ["PAYMENT_RECEIVED", "payment.confirmed"],
      ["PAYMENT_CONFIRMED", "payment.confirmed"],
      ["PAYMENT_OVERDUE", "payment.expired"],
      ["PAYMENT_DELETED", "payment.cancelled"],
      ["PAYMENT_REFUNDED", "payment.refunded"],
      ["PAYMENT_CHECKOUT_VIEWED", "unknown"],
    ];
    for (const [asaas, domain] of cases) {
      const result = await webhook("whsec_asaas", asaasEvent(asaas));
      expect(result.ok && result.value.eventType).toBe(domain);
      expect(result.ok && result.value.amountCents).toBe(5000);
      expect(result.ok && result.value.occurredAt).toBe("2026-10-13T13:00:00.000Z");
    }
  });

  it("rejects payloads without an event id (no Date.now() fallback that would break idempotency)", async () => {
    const { id: _id, ...withoutId } = asaasEvent("PAYMENT_RECEIVED");
    const result = await webhook("whsec_asaas", withoutId);
    expect(result.ok === false && result.error).toBe("malformed_payload");
  });
});

describe("Mercado Pago gateway", () => {
  const config = {
    accessToken: "APP_USR-test",
    webhookSecret: "mp_webhook_secret",
    payerFallbackEmail: "doacoes@purelifebrasil.org",
    pixExpirationMinutes: 60,
  };

  it("creates a PIX payment with X-Idempotency-Key and fallback payer e-mail", async () => {
    const calls = stubFetch(() =>
      jsonRes(201, {
        id: 123456789,
        status: "pending",
        date_of_expiration: "2026-10-13T11:00:00.000-03:00",
        point_of_interaction: { transaction_data: { qr_code: "000201MP", qr_code_base64: "iVBOR..." } },
      })
    );
    const key = crypto.randomUUID();
    const result = await createMercadoPagoGateway(config).createPix({
      amountCents: 1234,
      description: "Doação",
      idempotencyKey: key,
      externalReference: "intent-9",
    });

    expect(result).toEqual({
      ok: true,
      value: { providerChargeId: "123456789", pixCopyPaste: "000201MP", expiresAt: "2026-10-13T14:00:00.000Z" },
    });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-Idempotency-Key"]).toBe(key);
    expect(headers.Authorization).toBe("Bearer APP_USR-test");
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent).toMatchObject({ transaction_amount: 12.34, payment_method_id: "pix", payer: { email: "doacoes@purelifebrasil.org" } });
    expect(sent.date_of_expiration).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}-03:00$/);
  });

  async function signedRequest(dataId: string, secret = config.webhookSecret) {
    const ts = "1704908010";
    const requestId = "req-abc";
    const v1 = await hmacSha256Hex(secret, `id:${dataId};request-id:${requestId};ts:${ts};`);
    return {
      rawBody: JSON.stringify({ id: 999, type: "payment", action: "payment.updated", data: { id: dataId } }),
      headers: new Headers({ "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId }),
      url: `https://api.purelifebrasil.org/api/webhooks/payment?data.id=${dataId}&type=payment`,
    };
  }

  it("verifies the HMAC manifest and fetches the payment to obtain status and amount", async () => {
    const calls = stubFetch(() =>
      jsonRes(200, { id: 555, status: "approved", transaction_amount: 50, date_last_updated: "2026-10-13T10:05:00.000-03:00" })
    );
    const result = await createMercadoPagoGateway(config).verifyWebhook(await signedRequest("555"));

    expect(result).toEqual({
      ok: true,
      value: {
        provider: "mercadopago",
        eventId: "payment:555:approved",
        eventType: "payment.confirmed",
        providerChargeId: "555",
        amountCents: 5000,
        occurredAt: "2026-10-13T13:05:00.000Z",
      },
    });
    expect(calls[0].url).toBe("https://api.mercadopago.com/v1/payments/555");
  });

  it("rejects a forged signature without calling the API", async () => {
    const calls = stubFetch(() => jsonRes(200, {}));
    const result = await createMercadoPagoGateway(config).verifyWebhook(await signedRequest("555", "wrong-secret"));
    expect(result.ok === false && result.error).toBe("invalid_signature");
    expect(calls).toHaveLength(0);
  });

  it("rejects requests without x-signature", async () => {
    const req = await signedRequest("555");
    req.headers.delete("x-signature");
    const result = await createMercadoPagoGateway(config).verifyWebhook(req);
    expect(result.ok === false && result.error).toBe("invalid_signature");
  });

  it("maps expired PIX (cancelled/expired) and rejected payments", async () => {
    for (const [status, detail, expected] of [
      ["cancelled", "expired", "payment.expired"],
      ["cancelled", "by_collector", "payment.cancelled"],
      ["rejected", "cc_rejected_other_reason", "payment.failed"],
      ["refunded", "refunded", "payment.refunded"],
      ["pending", "pending_waiting_transfer", "unknown"],
    ] as const) {
      stubFetch(() => jsonRes(200, { id: 555, status, status_detail: detail, transaction_amount: 50 }));
      const result = await createMercadoPagoGateway(config).verifyWebhook(await signedRequest("555"));
      expect(result.ok && result.value.eventType).toBe(expected);
    }
  });

  it("asks for a retry (gateway_unavailable) when the payment lookup fails with 5xx", async () => {
    stubFetch(() => jsonRes(502, {}));
    const result = await createMercadoPagoGateway(config).verifyWebhook(await signedRequest("555"));
    expect(result.ok === false && result.error).toBe("gateway_unavailable");
  });
});
