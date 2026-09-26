import { z } from "zod";

export const triageSubmissionSchema = z.object({
  isAdult: z.literal(true, {
    errorMap: () => ({ message: "Este formulário é destinado a maiores de 18 anos." }),
  }),
  programInterest: z.enum(["residencial", "online", "esposas", "indefinido"]),
  profile: z.enum(["para_mim", "para_meu_conjuge", "para_um_familiar", "sou_lider"]),

  fullName: z.string().trim().min(2, "Nome deve ter pelo menos 2 caracteres").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(160),
  phone: z.string().trim().regex(/^\+?\d{10,15}$/, "Telefone deve conter de 10 a 15 dígitos com DDD").optional(),
  contactChannel: z.enum(["email", "telefone", "whatsapp"]),

  /** Opcional por desenho: ninguém é obrigado a relatar nada para pedir ajuda. */
  report: z.string().trim().max(2000, "Relato não pode exceder 2000 caracteres").optional(),

  consent: z.literal(true, {
    errorMap: () => ({ message: "É necessário concordar com a Política de Privacidade." }),
  }),
  policyVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Versão da política deve estar no formato YYYY-MM-DD"),
  turnstileToken: z.string().min(10).max(2048),
}).strict();
