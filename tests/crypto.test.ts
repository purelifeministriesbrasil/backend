import { describe, it, expect } from "vitest";
import { createAesGcmProvider } from "../src/infrastructure/crypto/aes-gcm.js";

describe("AES-256-GCM with AAD (§5.2)", () => {
  // 32-byte key encoded in Base64
  const testKeyV1 = btoa("12345678901234567890123456789012");
  const testKeyV2 = btoa("abcdefghijklmnopqrstuvwxyz123456");
  const provider = createAesGcmProvider({ 1: testKeyV1, 2: testKeyV2 }, 1);

  const defaultContext = {
    entityType: "triage_submission" as const,
    entityId: "11111111-2222-3333-4444-555555555555",
    field: "report" as const,
  };

  it("successfully encrypts and decrypts with identical AAD context", async () => {
    const plaintext = "Relato pastoral confidencial sobre restauração";
    const encrypted = await provider.encrypt(plaintext, defaultContext);
    expect(encrypted.algorithm).toBe("AES-256-GCM");
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.iv).toBeTruthy();

    const decrypted = await provider.decrypt(encrypted, defaultContext);
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

  it("rejects decryption if ciphertext is tampered by even 1 character (tag mismatch)", async () => {
    const plaintext = "Mensagem inviolável com integridade criptográfica";
    const encrypted = await provider.encrypt(plaintext, defaultContext);

    // Altera o último caractere do ciphertext em Base64
    const lastChar = encrypted.ciphertext.slice(-1);
    const alteredChar = lastChar === "A" ? "B" : "A";
    const tamperedCiphertext = encrypted.ciphertext.slice(0, -1) + alteredChar;

    await expect(
      provider.decrypt({ ...encrypted, ciphertext: tamperedCiphertext }, defaultContext)
    ).rejects.toThrow();
  });

  it("rejects decryption if IV is corrupted", async () => {
    const plaintext = "Teste de corrupção do vetor de inicialização";
    const encrypted = await provider.encrypt(plaintext, defaultContext);

    const tamperedIv = btoa("corrupted-12-byte-iv");
    await expect(
      provider.decrypt({ ...encrypted, iv: tamperedIv }, defaultContext)
    ).rejects.toThrow();
  });

  it("rejects decryption if key version is unknown to the provider", async () => {
    const plaintext = "Teste de chave inexistente";
    const encrypted = await provider.encrypt(plaintext, defaultContext);

    const unknownKeyVersionPayload = {
      ...encrypted,
      keyVersion: 999, // Chave 999 não existe no keyring
    };

    await expect(
      provider.decrypt(unknownKeyVersionPayload, defaultContext)
    ).rejects.toThrow(/crypto_key_missing:v999/);
  });

  it("handles empty string gracefully", async () => {
    const encrypted = await provider.encrypt("", defaultContext);
    const decrypted = await provider.decrypt(encrypted, defaultContext);
    expect(decrypted).toBe("");
  });

  it("accurately handles complex multibyte UTF-8 Portuguese strings", async () => {
    const complexText = "Coração quebrado, aflição e restauração em Cristo Jesus — Águas Lindas/GO, 2026! ✝";
    const encrypted = await provider.encrypt(complexText, defaultContext);
    const decrypted = await provider.decrypt(encrypted, defaultContext);
    expect(decrypted).toBe(complexText);
  });
});
