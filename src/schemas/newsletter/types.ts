import { z } from "zod";
import { newsletterSchema } from "./schema.js";

export type NewsletterSubscription = z.infer<typeof newsletterSchema>;
