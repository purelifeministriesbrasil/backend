import { triageSubmissionSchema } from "purelife-contracts";
import { guardRequest, assertBodySize } from "../../infrastructure/security/request-guards.js";
import { submitTriage } from "../../application/usecases/submit-triage.js";
import type { TriageUnitOfWork } from "../../application/ports/triage-unit-of-work.js";

export interface TurnstileDeps {
  turnstileSecret: string;
  verifyTurnstile: (token: string, secret: string, ip?: string) => Promise<boolean>;
}

export async function handleTriageSubmission(
  request: Request,
  env: { PUBLIC_SITE_ORIGIN: string },
  uow: TriageUnitOfWork,
  turnstile: TurnstileDeps
): Promise<Response> {
  const guard = guardRequest(request, env.PUBLIC_SITE_ORIGIN, {
    maxBytes: 8192,
    accept: ["application/json"],
  });
  if (guard) return guard;

  const raw = await request.text();
  if (!assertBodySize(raw, 8192)) {
    return new Response(JSON.stringify({ error: "payload_too_large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = triageSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({
        error: "validation_failed",
        details: parsed.error.format(),
      }),
      {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Validate Turnstile token (§7.3)
  const clientIp = request.headers.get("CF-Connecting-IP") ?? undefined;
  const turnstileValid = await turnstile.verifyTurnstile(
    parsed.data.turnstileToken,
    turnstile.turnstileSecret,
    clientIp
  );
  if (!turnstileValid) {
    return new Response(
      JSON.stringify({ error: "turnstile_failed", message: "Verificação de segurança falhou. Tente novamente." }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  const result = await submitTriage(parsed.data, { uow });
  if (!result.ok) {
    return new Response(
      JSON.stringify({ error: result.error }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  return new Response(JSON.stringify(result.value), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
