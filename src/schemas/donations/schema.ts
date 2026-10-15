import { z } from "zod/mini";
import { emailSchema, turnstileTokenSchema } from "../common/schema.js";

export const createPixSchema = z.strictObject({
  amountCents: z
    .int("O valor deve ser um número inteiro em centavos.")
    .check(z.gte(500, "Valor mínimo de R$ 5,00."), z.lte(5_000_000, "Valor máximo de R$ 50.000,00.")),
  frequency: z.enum(["one_time", "monthly"]),
  donorEmail: z.optional(emailSchema),
  turnstileToken: turnstileTokenSchema,
});

/** Resposta pública de `POST /api/donations/create-pix`. */
export const createPixResponseSchema = z.strictObject({
  chargeId: z.uuid(),
  provider: z.enum(["asaas", "mercadopago"]),
  pixCopyPaste: z.string().check(z.minLength(1)),
  expiresAt: z.iso.datetime({ offset: true }),
  amountCents: z.int(),
});

/** Contrato interno de evento de webhook após verificação de assinatura. */
export const paymentWebhookSchema = z.strictObject({
  provider: z.enum(["asaas", "mercadopago"]),
  eventId: z.string().check(z.minLength(1), z.maxLength(128)),
  eventType: z.enum([
    "payment.confirmed",
    "payment.failed",
    "payment.expired",
    "payment.cancelled",
    "payment.refunded",
    "unknown",
  ]),
  providerChargeId: z.string().check(z.minLength(1), z.maxLength(128)),
  amountCents: z.int().check(z.nonnegative()),
  occurredAt: z.iso.datetime({ offset: true }),
});
