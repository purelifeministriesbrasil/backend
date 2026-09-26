import { z } from "zod";

export const contactSubmissionSchema = z.object({
  fullName: z.string().trim().min(2, "Nome deve ter pelo menos 2 caracteres").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(160),
  phone: z.string().trim().regex(/^\+?\d{10,15}$/, "Telefone deve conter de 10 a 15 dígitos").optional(),
  subject: z.string().trim().min(2, "Assunto deve ter pelo menos 2 caracteres").max(100),
  message: z.string().trim().min(10, "Mensagem deve ter pelo menos 10 caracteres").max(3000),

  consent: z.literal(true, {
    errorMap: () => ({ message: "É necessário concordar com a Política de Privacidade." }),
  }),
  policyVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Versão da política deve estar no formato YYYY-MM-DD"),
  turnstileToken: z.string().min(10).max(2048),
}).strict();
