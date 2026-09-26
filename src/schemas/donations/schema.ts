import { z } from "zod";

export const createPixSchema = z.object({
  amountCents: z
    .number()
    .int("O valor deve ser um número inteiro em centavos.")
    .min(500, "Valor mínimo de R$ 5,00.")
    .max(5_000_000, "Valor máximo de R$ 50.000,00."),
  frequency: z.enum(["one_time", "monthly"]),
  donorEmail: z.string().trim().toLowerCase().email("E-mail inválido.").max(160).optional(),
  turnstileToken: z.string().min(10).max(2048),
}).strict();

/** Contrato interno de evento de webhook após verificação de assinatura. */
export const paymentWebhookSchema = z.object({
  provider: z.enum(["asaas", "mercadopago"]),
  eventId: z.string().min(1).max(128),
  eventType: z.enum(["payment.confirmed", "payment.failed", "payment.refunded", "unknown"]),
  providerChargeId: z.string().min(1).max(128),
  amountCents: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
}).strict();
