import { z } from "zod";
import { newsletterSchema } from "../../schemas/index.js";
import {
  assertBodySize,
  guardRequest,
  parseFormBody,
} from "../../infrastructure/security/request-guards.js";
import {
  confirmNewsletter,
  subscribeNewsletter,
  type SubscribeNewsletterDeps,
} from "../../application/usecases/subscribe-newsletter.js";
import { clientIp, json, readJson, serviceUnavailable, type TurnstileVerifier } from "../http.js";

const MAX_BYTES = 1024;
const NEUTRAL_MESSAGE = "Se o endereço informado puder receber mensagens, você receberá uma confirmação em breve.";

export interface NewsletterDeps {
  turnstile: TurnstileVerifier;
  newsletter: () => SubscribeNewsletterDeps;
}

/**
 * Inscrição com double opt-in. Resposta sempre neutra (§7.6): não revela se o e-mail já existe,
 * nem diferencia honeypot preenchido de inscrição real.
 * Sem JavaScript (form POST nativo) não há token Turnstile: a proteção é honeypot + origem + cooldown
 * de reenvio; com JavaScript o token é obrigatório quando presente e verificado.
 */
export async function handleNewsletterSubscription(
  request: Request,
  env: { PUBLIC_SITE_ORIGIN: string },
  deps: NewsletterDeps
): Promise<Response> {
  const guard = guardRequest(request, env.PUBLIC_SITE_ORIGIN, {
    maxBytes: MAX_BYTES,
    accept: ["application/json", "application/x-www-form-urlencoded"],
  });
  if (guard) return guard;

  const isJson = (request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
  const wantsJson = request.headers.get("accept")?.includes("application/json") ?? false;

  const neutral = () =>
    wantsJson
      ? json(200, { ok: true, message: NEUTRAL_MESSAGE })
      : new Response(null, { status: 303, headers: { Location: `${env.PUBLIC_SITE_ORIGIN}/?inscricao=confirmar` } });

  let data: unknown;
  if (isJson) {
    const read = await readJson(request, MAX_BYTES);
    if (read instanceof Response) return read;
    data = read.body;
  } else {
    const raw = await request.text();
    if (!assertBodySize(raw, MAX_BYTES)) return json(413, { error: "payload_too_large" });
    data = parseFormBody(raw);
    if (data === null) return json(400, { error: "duplicate_parameters" });
  }

  const parsed = newsletterSchema.safeParse(data);
  if (!parsed.success) {
    // Honeypot preenchido ou dados inválidos: resposta idêntica à de sucesso para não instruir bots.
    return neutral();
  }

  if (parsed.data.turnstileToken !== undefined) {
    const human = await deps.turnstile.verify(parsed.data.turnstileToken, clientIp(request));
    if (!human) {
      return wantsJson
        ? json(403, { error: "turnstile_failed", message: "Verificação de segurança falhou. Tente novamente." })
        : neutral();
    }
  }

  const result = await subscribeNewsletter(
    { email: parsed.data.email, policyVersion: parsed.data.policyVersion },
    deps.newsletter()
  );
  if (!result.ok) return serviceUnavailable();

  return neutral();
}

const confirmSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

/** Confirmação via POST disparado pela página /newsletter/confirmar/ (token no fragmento da URL). */
export async function handleNewsletterConfirmation(
  request: Request,
  env: { PUBLIC_SITE_ORIGIN: string },
  deps: { newsletter: () => Pick<SubscribeNewsletterDeps, "repo" | "tokens"> }
): Promise<Response> {
  const guard = guardRequest(request, env.PUBLIC_SITE_ORIGIN, { maxBytes: 256, accept: ["application/json"] });
  if (guard) return guard;

  const read = await readJson(request, 256);
  if (read instanceof Response) return read;

  const parsed = confirmSchema.safeParse(read.body);
  if (!parsed.success) return json(400, { error: "invalid_token", message: "Link de confirmação inválido." });

  const result = await confirmNewsletter(parsed.data.token, deps.newsletter());
  if (!result.ok) return serviceUnavailable();
  if (!result.value.confirmed) {
    return json(410, { error: "token_expired", message: "Este link expirou ou já foi utilizado." });
  }
  return json(200, { ok: true, message: "Inscrição confirmada. Obrigado!" });
}
