import { z } from "zod/mini";
import { emailSchema, phoneSchema, policyVersionSchema, turnstileTokenSchema } from "../common/schema.js";

export const contactSubmissionSchema = z.strictObject({
  fullName: z.string().check(z.trim(), z.minLength(2, "Nome deve ter pelo menos 2 caracteres"), z.maxLength(120)),
  email: emailSchema,
  phone: z.optional(phoneSchema),
  subject: z.string().check(z.trim(), z.minLength(2, "Assunto deve ter pelo menos 2 caracteres"), z.maxLength(100)),
  message: z.string().check(z.trim(), z.minLength(10, "Mensagem deve ter pelo menos 10 caracteres"), z.maxLength(3000)),

  consent: z.literal(true, { error: "É necessário concordar com a Política de Privacidade." }),
  policyVersion: policyVersionSchema,
  turnstileToken: turnstileTokenSchema,
});
