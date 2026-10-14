import type { NewsletterRepository } from "../ports/newsletter-repository.js";
import type { Notifier } from "../ports/notifier.js";
import type { UseCaseResult } from "../ports/result.js";

export const NEWSLETTER_CONFIRM_TTL_HOURS = 48;
/** Janela mínima entre reenvios de confirmação para o mesmo e-mail (anti e-mail bombing). */
export const NEWSLETTER_RESEND_COOLDOWN_SECONDS = 15 * 60;

export interface NewsletterTokens {
  /** Token opaco enviado por e-mail. */
  generate(): string;
  /** Hash persistido (o token puro nunca vai ao banco). */
  hash(token: string): Promise<string>;
}

export interface SubscribeNewsletterDeps {
  repo: NewsletterRepository;
  notifier: Notifier;
  tokens: NewsletterTokens;
  /** Monta o link absoluto de confirmação a partir do token. */
  confirmUrl: (token: string) => string;
  now?: () => Date;
}

/**
 * Double opt-in. A resposta ao cliente é sempre neutra (não revela se o e-mail já existe);
 * por isso o resultado só distingue sucesso de falha de infraestrutura.
 */
export async function subscribeNewsletter(
  input: { email: string; policyVersion: string },
  deps: SubscribeNewsletterDeps
): Promise<UseCaseResult<{ confirmationSent: boolean }, "newsletter_persistence_failed">> {
  const now = deps.now?.() ?? new Date();
  const token = deps.tokens.generate();

  let outcome;
  try {
    outcome = await deps.repo.upsertPending({
      email: input.email,
      policyVersion: input.policyVersion,
      consentedAt: now,
      confirmTokenHash: await deps.tokens.hash(token),
      confirmExpiresAt: new Date(now.getTime() + NEWSLETTER_CONFIRM_TTL_HOURS * 60 * 60 * 1000),
      resendCooldownSeconds: NEWSLETTER_RESEND_COOLDOWN_SECONDS,
      now,
    });
  } catch {
    return { ok: false, kind: "infrastructure", error: "newsletter_persistence_failed", retryable: true };
  }

  if (outcome.kind === "no_action") {
    return { ok: true, value: { confirmationSent: false } };
  }

  const sent = await deps.notifier.sendToRecipient(
    input.email,
    "Confirme sua inscrição — Pure Life Ministries Brasil",
    "Recebemos um pedido para inscrever este e-mail na newsletter da Pure Life Ministries Brasil.\n\n" +
      `Para confirmar, acesse: ${deps.confirmUrl(token)}\n\n` +
      `O link expira em ${NEWSLETTER_CONFIRM_TTL_HOURS} horas. Se você não fez este pedido, ignore esta mensagem.`
  );

  return { ok: true, value: { confirmationSent: sent } };
}

export async function confirmNewsletter(
  token: string,
  deps: { repo: NewsletterRepository; tokens: Pick<NewsletterTokens, "hash">; now?: () => Date }
): Promise<UseCaseResult<{ confirmed: boolean }, "newsletter_persistence_failed">> {
  try {
    const confirmed = await deps.repo.confirm(await deps.tokens.hash(token), deps.now?.() ?? new Date());
    return { ok: true, value: { confirmed } };
  } catch {
    return { ok: false, kind: "infrastructure", error: "newsletter_persistence_failed", retryable: true };
  }
}
