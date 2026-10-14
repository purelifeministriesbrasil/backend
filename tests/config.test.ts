import { describe, it, expect } from "vitest";
import {
  ConfigError,
  readCryptoConfig,
  readPaymentConfig,
  readTurnstileSecret,
} from "../src/infrastructure/config/env.js";
import { createAesGcmProvider } from "../src/infrastructure/crypto/aes-gcm.js";
import { randomKeyB64, validEnv } from "./helpers.js";

function configError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw err;
  }
  throw new Error("expected ConfigError");
}

describe("Configuração fail-closed", () => {
  it("selects the payment provider via PAYMENT_PROVIDER", () => {
    expect(readPaymentConfig(validEnv()).provider).toBe("asaas");
    expect(
      readPaymentConfig(
        validEnv({
          PAYMENT_PROVIDER: "mercadopago",
          MERCADOPAGO_ACCESS_TOKEN: "APP_USR-x",
          MERCADOPAGO_WEBHOOK_SECRET: "s",
          MERCADOPAGO_PAYER_FALLBACK_EMAIL: "doacoes@purelifebrasil.org",
        })
      ).provider
    ).toBe("mercadopago");
  });

  it("lists missing credentials of the selected provider by name only", () => {
    const err = configError(() => readPaymentConfig(validEnv({ PAYMENT_PROVIDER: "mercadopago" })));
    expect(err.invalidKeys).toEqual([
      "MERCADOPAGO_ACCESS_TOKEN",
      "MERCADOPAGO_WEBHOOK_SECRET",
      "MERCADOPAGO_PAYER_FALLBACK_EMAIL",
    ]);
  });

  it("rejects unknown providers, non-HTTPS Asaas URLs and out-of-range PIX expiration", () => {
    expect(configError(() => readPaymentConfig(validEnv({ PAYMENT_PROVIDER: "stripe" }))).invalidKeys).toEqual(["PAYMENT_PROVIDER"]);
    expect(configError(() => readPaymentConfig(validEnv({ ASAAS_API_BASE_URL: "http://api.asaas.com/v3" }))).invalidKeys).toEqual(["ASAAS_API_BASE_URL"]);
    expect(configError(() => readPaymentConfig(validEnv({ PIX_EXPIRATION_MINUTES: "10" }))).invalidKeys).toEqual(["PIX_EXPIRATION_MINUTES"]);
  });

  it("validates AES keys (32 bytes Base64) and pepper length", () => {
    expect(readCryptoConfig(validEnv()).currentVersion).toBe(1);
    expect(configError(() => readCryptoConfig(validEnv({ TRIAGE_KEY_V1: randomKeyB64(16) }))).invalidKeys).toContain("TRIAGE_KEY_V1");
    expect(configError(() => readCryptoConfig(validEnv({ TRIAGE_KEY_V1: "não é base64!" }))).invalidKeys).toContain("TRIAGE_KEY_V1");
    expect(configError(() => readCryptoConfig(validEnv({ HASH_PEPPER: randomKeyB64(8) }))).invalidKeys).toContain("HASH_PEPPER");
    expect(configError(() => readCryptoConfig(validEnv({ TRIAGE_KEY_CURRENT_VERSION: "2" }))).invalidKeys).toContain("TRIAGE_KEY_CURRENT_VERSION");
  });

  it("supports key rotation with multiple versions", () => {
    const config = readCryptoConfig(validEnv({ TRIAGE_KEY_V2: randomKeyB64(), TRIAGE_KEY_CURRENT_VERSION: "2" }));
    expect(Object.keys(config.keys).sort()).toEqual(["1", "2"]);
    expect(config.currentVersion).toBe(2);
  });

  it("forbids Turnstile test secrets in production only", () => {
    expect(readTurnstileSecret(validEnv())).toBe("1x0000000000000000000000000000000AA");
    expect(() => readTurnstileSecret(validEnv({ ENVIRONMENT: "production" }))).toThrow(ConfigError);
    expect(readTurnstileSecret(validEnv({ ENVIRONMENT: "production", TURNSTILE_SECRET_KEY: "0x4AAAAAAAreal-secret" }))).toBe(
      "0x4AAAAAAAreal-secret"
    );
  });

  it("AES-GCM provider refuses keys of the wrong size at construction", () => {
    expect(() => createAesGcmProvider({ 1: randomKeyB64(16) }, 1)).toThrow(/crypto_key_invalid:v1/);
    expect(() => createAesGcmProvider({ 1: randomKeyB64() }, 2)).toThrow(/crypto_key_missing:v2/);
  });

  it("AES-GCM never reuses IVs across encryptions of the same plaintext", async () => {
    const provider = createAesGcmProvider({ 1: randomKeyB64() }, 1);
    const ctx = { entityType: "triage_submission" as const, entityId: "id", field: "report" as const };
    const ivs = new Set<string>();
    for (let i = 0; i < 200; i++) ivs.add((await provider.encrypt("mesmo texto", ctx)).iv);
    expect(ivs.size).toBe(200);
  });
});
