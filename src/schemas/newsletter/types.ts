import type { z } from "zod/mini";
import { newsletterSchema, newsletterTokenSchema } from "./schema.js";

export type NewsletterSubscription = z.infer<typeof newsletterSchema>;
export type NewsletterTokenRequest = z.infer<typeof newsletterTokenSchema>;
