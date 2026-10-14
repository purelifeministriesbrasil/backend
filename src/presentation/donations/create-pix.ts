import { createPixSchema } from "../../schemas/index.js";
import { guardRequest, readIdempotencyKey } from "../../infrastructure/security/request-guards.js";
import { createPixCharge, type CreatePixDeps } from "../../application/usecases/create-pix-charge.js";
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

const MAX_BYTES = 4096;

export async function handleCreatePix(
  request: Request,
  env: { PUBLIC_SITE_ORIGIN: string },
  deps: { turnstile: TurnstileVerifier; donations: () => CreatePixDeps }
): Promise<Response> {
  const guard = guardRequest(request, env.PUBLIC_SITE_ORIGIN, { maxBytes: MAX_BYTES, accept: ["application/json"] });
  if (guard) return guard;

  const idempotencyKey = readIdempotencyKey(request);
  if (!idempotencyKey) return missingIdempotencyKey();

  const read = await readJson(request, MAX_BYTES);
  if (read instanceof Response) return read;

  const parsed = createPixSchema.safeParse(read.body);
  if (!parsed.success) return validationFailed(parsed.error);

  if (!(await deps.turnstile.verify(parsed.data.turnstileToken, clientIp(request)))) return turnstileFailed();

  const result = await createPixCharge(parsed.data, idempotencyKey, deps.donations());
  if (result.ok) return json(200, result.value);

  switch (result.error) {
    case "idempotency_conflict":
      return json(409, { error: result.error, message: "Recarregue a página e gere uma nova doação." });
    case "gateway_rejected":
      return json(502, {
        error: result.error,
        message: "O provedor de pagamento recusou a cobrança. Tente outro valor ou mais tarde.",
      });
    case "gateway_unavailable":
      return json(503, {
        error: result.error,
        message: "O provedor de pagamento está indisponível no momento. Tente novamente em instantes.",
      });
    default:
      return internalError();
  }
}
