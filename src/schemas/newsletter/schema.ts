import { z } from "zod";
import { emailSchema, policyVersionSchema, turnstileTokenSchema } from "../common/schema.js";

export const newsletterSchema = z.object({
  email: emailSchema,
  website: z.string().max(0, "Campo de segurança inválido").optional(), // honeypot
  policyVersion: policyVersionSchema,
  turnstileToken: turnstileTokenSchema.optional(), // ausente no fallback sem JS
}).strict();
