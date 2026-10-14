import { triageSubmissionSchema } from "../../schemas/index.js";
import { guardRequest, readIdempotencyKey } from "../../infrastructure/security/request-guards.js";
import { submitTriage, type SubmitTriageDeps } from "../../application/usecases/submit-triage.js";
import {
  clientIp,
  internalError,
  json,
  missingIdempotencyKey,
  readJson,
  turnstileFailed,
  validationFailed,
  type TurnstileVerifier,
} from "../http.js";

const MAX_BYTES = 8192;

export async function handleTriageSubmission(
  request: Request,
  env: { PUBLIC_SITE_ORIGIN: string },
  deps: { turnstile: TurnstileVerifier; triage: () => SubmitTriageDeps }
): Promise<Response> {
  const guard = guardRequest(request, env.PUBLIC_SITE_ORIGIN, { maxBytes: MAX_BYTES, accept: ["application/json"] });
  if (guard) return guard;

  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) return missingIdempotencyKey();

  const read = await readJson(request, MAX_BYTES);
  if (read instanceof Response) return read;

  const parsed = triageSubmissionSchema.safeParse(read.body);
  if (!parsed.success) return validationFailed(parsed.error);

  if (!(await deps.turnstile.verify(parsed.data.turnstileToken, clientIp(request)))) return turnstileFailed();

  const result = await submitTriage(parsed.data, idempotencyKey, deps.triage());
  if (!result.ok) return internalError();

  return json(200, result.value);
}
