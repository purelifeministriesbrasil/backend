import { z } from "zod";
import { emailSchema, phoneSchema, policyVersionSchema, turnstileTokenSchema } from "../common/schema.js";

export const contactSubmissionSchema = z.object({
  fullName: z.string().trim().min(2, "Nome deve ter pelo menos 2 caracteres").max(120),
  email: emailSchema,
  phone: phoneSchema.optional(),
  subject: z.string().trim().min(2, "Assunto deve ter pelo menos 2 caracteres").max(100),
  message: z.string().trim().min(10, "Mensagem deve ter pelo menos 10 caracteres").max(3000),

  consent: z.literal(true, { error: "É necessário concordar com a Política de Privacidade." }),
  policyVersion: policyVersionSchema,
  turnstileToken: turnstileTokenSchema,
}).strict();
