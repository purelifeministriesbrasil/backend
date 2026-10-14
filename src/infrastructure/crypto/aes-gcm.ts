import type {
  EncryptionProvider,
  EncryptedPayload,
  EncryptionContext,
} from "../../application/ports/encryption-provider.js";

const ALGO = "AES-GCM";
const IV_BYTES = 12;
const TAG_BITS = 128;
const KEY_BYTES = 32;

const toB64 = (b: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(b)));

const fromB64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * AAD vincula o ciphertext ao registro, campo e versão de chave: um ciphertext copiado
 * para outra linha ou coluna falha na verificação da tag GCM.
 */
function aad(ctx: EncryptionContext): Uint8Array {
  return new TextEncoder().encode(
    `${ctx.entityType}:${ctx.entityId}:${ctx.field}:v${ctx.keyVersion}`
  );
}

function decodeKey(version: number, raw: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = fromB64(raw);
  } catch {
    throw new Error(`crypto_key_invalid:v${version}`);
  }
  if (bytes.byteLength !== KEY_BYTES) {
    throw new Error(`crypto_key_invalid:v${version}`);
  }
  return bytes;
}

/**
 * Cria o provedor AES-256-GCM. Valida todas as chaves na construção (fail-fast):
 * chave ausente, Base64 inválido ou tamanho diferente de 32 bytes lança `crypto_key_invalid`.
 * O IV é aleatório (CSPRNG, 96 bits) por operação — nunca derivado ou reutilizado.
 */
export function createAesGcmProvider(
  keys: Record<number, string>,
  currentVersion: number
): EncryptionProvider {
  const rawKeys = new Map<number, Uint8Array>();
  for (const [version, raw] of Object.entries(keys)) {
    rawKeys.set(Number(version), decodeKey(Number(version), raw));
  }
  if (!rawKeys.has(currentVersion)) {
    throw new Error(`crypto_key_missing:v${currentVersion}`);
  }

  const cache = new Map<number, Promise<CryptoKey>>();
  function importKey(version: number): Promise<CryptoKey> {
    const raw = rawKeys.get(version);
    if (!raw) return Promise.reject(new Error(`crypto_key_missing:v${version}`));
    let key = cache.get(version);
    if (!key) {
      key = crypto.subtle.importKey("raw", raw as BufferSource, ALGO, false, ["encrypt", "decrypt"]);
      cache.set(version, key);
    }
    return key;
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
        iv: toB64(iv),
        keyVersion: currentVersion,
        algorithm: "AES-256-GCM",
      } satisfies EncryptedPayload;
    },

    async decrypt(payload, ctx) {
      const iv = fromB64(payload.iv);
      if (iv.byteLength !== IV_BYTES) throw new Error("crypto_iv_invalid");
      const key = await importKey(payload.keyVersion);
      const plain = await crypto.subtle.decrypt(
        {
          name: ALGO,
          iv: iv as BufferSource,
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
