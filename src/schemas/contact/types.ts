import { z } from "zod";
import { contactSubmissionSchema } from "./schema.js";

export type ContactSubmission = z.infer<typeof contactSubmissionSchema>;
