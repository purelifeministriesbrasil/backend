import { z } from "zod/mini";
import { emailSchema, policyVersionSchema, turnstileTokenSchema } from "../common/schema.js";

export const newsletterSchema = z.strictObject({
  email: emailSchema,
  website: z.optional(z.string().check(z.maxLength(0, "Campo de segurança inválido"))), // honeypot
  policyVersion: policyVersionSchema,
  turnstileToken: z.optional(turnstileTokenSchema), // ausente no fallback sem JS
});
