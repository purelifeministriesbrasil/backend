import { z } from "zod";
import { idempotencyKeySchema } from "./schema.js";

export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;
