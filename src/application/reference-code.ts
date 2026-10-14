// Alfabeto Crockford Base32 sem caracteres ambíguos (I, L, O, U): fácil de ditar por telefone.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Código de referência público, ex.: "PLM-7KQ2-9XHM" (40 bits de entropia de CSPRNG).
 * Substitui `Math.random()` de 6 dígitos, cujo espaço (900 mil) colidia com poucos milhares de registros.
 */
export function generateReferenceCode(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = Array.from(bytes, (b) => ALPHABET[b & 31]);
  return `${prefix}-${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}
