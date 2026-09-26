import { newsletterSchema } from "../../schemas/index.js";
import { assertBodySize } from "../../infrastructure/security/request-guards.js";

export async function handleNewsletterSubscription(
  request: Request,
  _env: unknown
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }

  const contentType = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (
    contentType !== "application/json" &&
    contentType !== "application/x-www-form-urlencoded"
  ) {
    return new Response(null, { status: 415 });
  }

  const raw = await request.text();
  if (!assertBodySize(raw, 1024)) {
    return new Response(null, { status: 413 });
  }

  let data: Record<string, unknown>;
  try {
    data =
      contentType === "application/json"
        ? JSON.parse(raw)
        : Object.fromEntries(new URLSearchParams(raw));
  } catch {
    return new Response(null, { status: 400 });
  }

  const parsed = newsletterSchema.safeParse(data);
  if (!parsed.success) {
    // Resposta neutra para segurança (§7.6)
    return new Response(
      JSON.stringify({
        ok: true,
        message: "Se o endereço puder receber inscrições, enviaremos uma confirmação.",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const wantsJson = request.headers.get("accept")?.includes("application/json");
  if (wantsJson) {
    return new Response(
      JSON.stringify({
        ok: true,
        message: "Se o endereço informado puder receber mensagens, você receberá uma confirmação em breve.",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Fallback sem JavaScript: redirecionamento 303 para a página inicial com status
  return new Response(null, {
    status: 303,
    headers: { Location: "/?inscricao=confirmar" },
  });
}
