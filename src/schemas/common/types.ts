import type { z } from "zod/mini";
import { idempotencyKeySchema } from "./schema.js";

export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;
