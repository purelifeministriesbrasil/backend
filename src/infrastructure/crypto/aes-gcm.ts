import type {
  EncryptionProvider,
  EncryptedPayload,
  EncryptionContext,
} from "../../application/ports/encryption-provider.js";

const ALGO = "AES-GCM";
const IV_BYTES = 12;
const TAG_BITS = 128;

const toB64 = (b: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(b)));

const fromB64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function aad(ctx: EncryptionContext): Uint8Array {
  return new TextEncoder().encode(
    `${ctx.entityType}:${ctx.entityId}:${ctx.field}:v${ctx.keyVersion}`
  );
}

export function createAesGcmProvider(
  keys: Record<number, string>,
  currentVersion: number
): EncryptionProvider {
  async function importKey(version: number): Promise<CryptoKey> {
    const raw = keys[version];
    if (!raw) throw new Error(`crypto_key_missing:v${version}`);
    return crypto.subtle.importKey(
      "raw",
      fromB64(raw) as BufferSource,
      ALGO,
      false,
      ["encrypt", "decrypt"]
    );
  }

  return {
    async encrypt(plaintext, ctx) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const key = await importKey(currentVersion);
      const ciphertext = await crypto.subtle.encrypt(
        {
          name: ALGO,
          iv: iv as BufferSource,
          additionalData: aad({ ...ctx, keyVersion: currentVersion }) as BufferSource,
          tagLength: TAG_BITS,
        },
        key,
        new TextEncoder().encode(plaintext) as BufferSource
      );

      return {
        ciphertext: toB64(ciphertext),
        iv: toB64(iv.buffer),
        keyVersion: currentVersion,
        algorithm: "AES-256-GCM",
      };
    },

    async decrypt(payload, ctx) {
      const key = await importKey(payload.keyVersion);
      const plain = await crypto.subtle.decrypt(
        {
          name: ALGO,
          iv: fromB64(payload.iv) as BufferSource,
          additionalData: aad({ ...ctx, keyVersion: payload.keyVersion }) as BufferSource,
          tagLength: TAG_BITS,
        },
        key,
        fromB64(payload.ciphertext) as BufferSource
      );

      return new TextDecoder().decode(plain);
    },
  };
}
