import { describe, it, expect } from "vitest";
import { createAesGcmProvider } from "../src/infrastructure/crypto/aes-gcm.js";

describe("AES-256-GCM with AAD (§5.2)", () => {
  // 32-byte key encoded in Base64
  const testKeyV1 = btoa("12345678901234567890123456789012");
  const provider = createAesGcmProvider({ 1: testKeyV1 }, 1);

  it("successfully encrypts and decrypts with identical AAD context", async () => {
    const plaintext = "Relato pastoral confidencial sobre restauração";
    const context = {
      entityType: "triage_submission" as const,
      entityId: "11111111-2222-3333-4444-555555555555",
      field: "report" as const,
    };

    const encrypted = await provider.encrypt(plaintext, context);
    expect(encrypted.algorithm).toBe("AES-256-GCM");
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.iv).toBeTruthy();

    const decrypted = await provider.decrypt(encrypted, context);
    expect(decrypted).toBe(plaintext);
  });

  it("rejects decryption if field in AAD is swapped (tampering detection)", async () => {
    const plaintext = "Telefone confidencial: 61999998888";
    const context = {
      entityType: "triage_submission" as const,
      entityId: "11111111-2222-3333-4444-555555555555",
      field: "contact" as const,
    };

    const encrypted = await provider.encrypt(plaintext, context);

    // Tentativa de decifrar o campo 'contact' como se fosse 'report'
    const tamperedContext = {
      ...context,
      field: "report" as const,
    };

    await expect(provider.decrypt(encrypted, tamperedContext)).rejects.toThrow();
  });

  it("rejects decryption if entityId in AAD differs", async () => {
    const plaintext = "Dados sensíveis";
    const context = {
      entityType: "triage_submission" as const,
      entityId: "aaaa-aaaa-aaaa-aaaa",
      field: "contact" as const,
    };

    const encrypted = await provider.encrypt(plaintext, context);

    const wrongEntityContext = {
      ...context,
      entityId: "bbbb-bbbb-bbbb-bbbb",
    };

    await expect(provider.decrypt(encrypted, wrongEntityContext)).rejects.toThrow();
  });
});
