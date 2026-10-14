import { contactSubmissionSchema } from "../../schemas/index.js";
import { guardRequest, readIdempotencyKey } from "../../infrastructure/security/request-guards.js";
import { submitContact, type SubmitContactDeps } from "../../application/usecases/submit-contact.js";
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

export async function handleContactSubmission(
  request: Request,
  env: { PUBLIC_SITE_ORIGIN: string },
  deps: { turnstile: TurnstileVerifier; contact: () => SubmitContactDeps }
): Promise<Response> {
  const guard = guardRequest(request, env.PUBLIC_SITE_ORIGIN, { maxBytes: MAX_BYTES, accept: ["application/json"] });
  if (guard) return guard;

  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) return missingIdempotencyKey();

  const read = await readJson(request, MAX_BYTES);
  if (read instanceof Response) return read;

  const parsed = contactSubmissionSchema.safeParse(read.body);
  if (!parsed.success) return validationFailed(parsed.error);

  if (!(await deps.turnstile.verify(parsed.data.turnstileToken, clientIp(request)))) return turnstileFailed();

  const result = await submitContact(parsed.data, idempotencyKey, deps.contact());
  if (!result.ok) return internalError();

  return json(200, { ok: true, referenceCode: result.value.referenceCode });
}
