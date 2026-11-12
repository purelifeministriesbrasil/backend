import { z } from "zod/mini";
import { emailSchema, policyVersionSchema, turnstileTokenSchema } from "../common/schema.js";

export const newsletterSchema = z.strictObject({
  email: emailSchema,
  website: z.optional(z.string().check(z.maxLength(0, "Campo de segurança inválido"))), // honeypot
  policyVersion: policyVersionSchema,
  turnstileToken: z.optional(turnstileTokenSchema), // ausente no fallback sem JS
});

/** Token de uso único dos links de confirmação e de descadastro: 32 bytes em base64url, sem padding. */
export const newsletterTokenSchema = z.strictObject({
  token: z.string().check(z.regex(/^[A-Za-z0-9_-]{43}$/, "Link inválido")),
});
