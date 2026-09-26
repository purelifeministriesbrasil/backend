import { z } from "zod";
import { createPixSchema, paymentWebhookSchema } from "./schema.js";

export type CreatePixInput = z.infer<typeof createPixSchema>;
export type PaymentWebhookPayload = z.infer<typeof paymentWebhookSchema>;
export type DonationFrequency = CreatePixInput["frequency"];
export type PaymentProvider = PaymentWebhookPayload["provider"];
export type PaymentEventType = PaymentWebhookPayload["eventType"];
