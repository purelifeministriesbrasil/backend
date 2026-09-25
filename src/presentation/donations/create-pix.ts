import { createPixSchema } from "purelife-contracts";
import { guardRequest, assertBodySize } from "../../infrastructure/security/request-guards.js";
import { createPixCharge } from "../../application/usecases/create-pix-charge.js";
import type { PaymentGateway } from "../../application/ports/payment-gateway.js";

export interface TurnstileDeps {
  turnstileSecret: string;
  verifyTurnstile: (token: string, secret: string, ip?: string) => Promise<boolean>;
}

export async function handleCreatePix(
  request: Request,
  env: { PUBLIC_SITE_ORIGIN: string },
  gateway: PaymentGateway,
  turnstile: TurnstileDeps
): Promise<Response> {
  const guard = guardRequest(request, env.PUBLIC_SITE_ORIGIN, {
    maxBytes: 4096,
    accept: ["application/json"],
  });
  if (guard) return guard;

  const raw = await request.text();
  if (!assertBodySize(raw, 4096)) {
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

  const parsed = createPixSchema.safeParse(body);
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

  const result = await createPixCharge(parsed.data, { gateway });
  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(result.value), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
