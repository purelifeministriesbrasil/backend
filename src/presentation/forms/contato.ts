import { contactSubmissionSchema } from "purelife-contracts";
import { guardRequest, assertBodySize } from "../../infrastructure/security/request-guards.js";

export async function handleContactSubmission(
  request: Request,
  env: { PUBLIC_SITE_ORIGIN: string }
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

  const parsed = contactSubmissionSchema.safeParse(body);
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

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
