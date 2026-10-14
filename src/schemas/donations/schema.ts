import { z } from "zod";
import { emailSchema, turnstileTokenSchema } from "../common/schema.js";

export const createPixSchema = z.object({
  amountCents: z
    .number()
    .int("O valor deve ser um número inteiro em centavos.")
    .min(500, "Valor mínimo de R$ 5,00.")
    .max(5_000_000, "Valor máximo de R$ 50.000,00."),
  frequency: z.enum(["one_time", "monthly"]),
  donorEmail: emailSchema.optional(),
  turnstileToken: turnstileTokenSchema,
}).strict();

/** Resposta pública de `POST /api/donations/create-pix`. */
export const createPixResponseSchema = z.object({
  chargeId: z.uuid(),
  provider: z.enum(["asaas", "mercadopago"]),
  pixCopyPaste: z.string().min(1),
  expiresAt: z.iso.datetime({ offset: true }),
  amountCents: z.number().int(),
}).strict();

/** Contrato interno de evento de webhook após verificação de assinatura. */
export const paymentWebhookSchema = z.object({
  provider: z.enum(["asaas", "mercadopago"]),
  eventId: z.string().min(1).max(128),
  eventType: z.enum([
    "payment.confirmed",
    "payment.failed",
    "payment.expired",
    "payment.cancelled",
    "payment.refunded",
    "unknown",
  ]),
  providerChargeId: z.string().min(1).max(128),
  amountCents: z.number().int().nonnegative(),
  occurredAt: z.iso.datetime({ offset: true }),
}).strict();
