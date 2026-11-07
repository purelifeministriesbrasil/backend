export type NewsletterUpsertOutcome =
  /** Nova inscrição ou inscrição pendente cujo token foi renovado: enviar e-mail de confirmação. */
  | { kind: "confirmation_required" }
  /** Já confirmada, ou confirmação reenviada há pouco (anti e-mail bombing): não enviar nada. */
  | { kind: "no_action" };

export interface NewsletterRepository {
  /**
   * Cria ou renova inscrição pendente. Deduplicação por HMAC do e-mail (sem e-mail em claro).
   * `confirmTokenHash` é o SHA-256 do token enviado por e-mail; o token puro nunca é persistido.
   */
  upsertPending(input: {
    email: string;
    policyVersion: string;
    consentedAt: Date;
    confirmTokenHash: string;
    confirmExpiresAt: Date;
    /** SHA-256 do token de descadastro (uso único); o token puro nunca é persistido. */
    unsubscribeTokenHash: string;
    unsubscribeExpiresAt: Date;
    resendCooldownSeconds: number;
    now: Date;
  }): Promise<NewsletterUpsertOutcome>;

  /** Confirma pelo hash do token, se ainda válido. Retorna `true` se alguma inscrição foi confirmada. */
  confirm(confirmTokenHash: string, now: Date): Promise<boolean>;

  /**
   * Descadastra pelo hash do token, se válido, não expirado e ainda não usado. Invalida o token (uso único)
   * e os tokens de confirmação. Retorna `true` se alguma inscrição mudou para `unsubscribed`.
   */
  unsubscribe(unsubscribeTokenHash: string, now: Date): Promise<boolean>;
}
