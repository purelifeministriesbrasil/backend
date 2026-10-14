import { z } from "zod";
import { emailSchema, phoneSchema, policyVersionSchema, turnstileTokenSchema } from "../common/schema.js";

export const triageSubmissionSchema = z.object({
  isAdult: z.literal(true, { error: "Este formulário é destinado a maiores de 18 anos." }),
  programInterest: z.enum(["residencial", "online", "esposas", "indefinido"]),
  profile: z.enum(["para_mim", "para_meu_conjuge", "para_um_familiar", "sou_lider"]),

  fullName: z.string().trim().min(2, "Nome deve ter pelo menos 2 caracteres").max(120),
  email: emailSchema,
  phone: phoneSchema.optional(),
  contactChannel: z.enum(["email", "telefone", "whatsapp"]),

  /** Opcional por desenho: ninguém é obrigado a relatar nada para pedir ajuda. */
  report: z.string().trim().max(2000, "Relato não pode exceder 2000 caracteres").optional(),

  consent: z.literal(true, { error: "É necessário concordar com a Política de Privacidade." }),
  policyVersion: policyVersionSchema,
  turnstileToken: turnstileTokenSchema,
}).strict();
