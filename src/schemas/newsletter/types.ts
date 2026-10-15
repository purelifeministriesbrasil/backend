import type { z } from "zod/mini";
import { newsletterSchema } from "./schema.js";

export type NewsletterSubscription = z.infer<typeof newsletterSchema>;
