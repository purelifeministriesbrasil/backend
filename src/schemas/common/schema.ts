import { z } from "zod";

/** Remove separadores visuais comuns ("(61) 90000-0000") antes da validação de dígitos. */
const stripPhoneSeparators = (value: string): string => value.replace(/[\s().-]/g, "");

export const phoneSchema = z
  .string()
  .trim()
  .overwrite(stripPhoneSeparators)
  .regex(/^\+?\d{10,15}$/, "Telefone deve conter de 10 a 15 dígitos com DDD");

export const emailSchema = z.string().trim().toLowerCase().email("E-mail inválido").max(160);

export const policyVersionSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Versão da política deve estar no formato YYYY-MM-DD");

export const turnstileTokenSchema = z.string().min(10).max(2048);

/** Valor do header `Idempotency-Key`: UUID v4 gerado pelo cliente por tentativa lógica de envio. */
export const idempotencyKeySchema = z.uuidv4("Idempotency-Key deve ser um UUID v4");

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
