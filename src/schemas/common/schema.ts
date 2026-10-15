import { z } from "zod/mini";

/** Remove separadores visuais comuns ("(61) 90000-0000") antes da validação de dígitos. */
const stripPhoneSeparators = (value: string): string => value.replace(/[\s().-]/g, "");

// zod/mini: mesma validação do Zod 4 com API funcional (tree-shakeable), ~4x menor no navegador.
export const phoneSchema = z.string().check(
  z.trim(),
  z.overwrite(stripPhoneSeparators),
  z.regex(/^\+?\d{10,15}$/, "Telefone deve conter de 10 a 15 dígitos com DDD")
);

/** Normaliza (trim + minúsculas) antes de validar o formato, como no encadeamento do Zod clássico. */
export const emailSchema = z.pipe(
  z.string("E-mail inválido").check(z.trim(), z.toLowerCase()),
  z.email("E-mail inválido").check(z.maxLength(160))
);

export const policyVersionSchema = z
  .string()
  .check(z.regex(/^\d{4}-\d{2}-\d{2}$/, "Versão da política deve estar no formato YYYY-MM-DD"));

export const turnstileTokenSchema = z.string().check(z.minLength(10), z.maxLength(2048));

/** Valor do header `Idempotency-Key`: UUID v4 gerado pelo cliente por tentativa lógica de envio. */
export const idempotencyKeySchema = z.uuidv4("Idempotency-Key deve ser um UUID v4");

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
