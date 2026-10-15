import type { z } from "zod/mini";
import { contactSubmissionSchema } from "./schema.js";

export type ContactSubmission = z.infer<typeof contactSubmissionSchema>;
