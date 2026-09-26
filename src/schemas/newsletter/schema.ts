import { z } from "zod";

export const newsletterSchema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail inválido").max(160),
  website: z.string().max(0, "Campo de segurança inválido").optional(), // honeypot
  policyVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Versão da política deve estar no formato YYYY-MM-DD"),
  turnstileToken: z.string().min(10).max(2048).optional(), // ausente no fallback sem JS
}).strict();
