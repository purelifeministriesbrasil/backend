// Aplicação das regras de retenção de newsletter, auditoria e webhooks (§5.5). Complementa o expurgo de
// triagens e contatos. Funções separadas por etapa para que a falha de uma não bloqueie as outras.
import {
  AUDIT_RETENTION_DAYS,
  NEWSLETTER_PENDING_RETENTION_DAYS,
  NEWSLETTER_UNSUBSCRIBED_RETENTION_DAYS,
  WEBHOOK_RETENTION_DAYS,
  cutoff,
} from "../retention-policy.js";
import type { RetentionRepository } from "../ports/retention-repository.js";

export interface RetentionInput {
  now?: Date;
  limit?: number;
}

const DEFAULT_LIMIT = 500;

export function createRetentionUseCases(repo: RetentionRepository) {
  return {
    /** Newsletter: apaga pendentes vencidas e anonimiza cancelamentos antigos. Devolve o total tratado. */
    async newsletter({ now = new Date(), limit = DEFAULT_LIMIT }: RetentionInput = {}): Promise<number> {
      const deleted = await repo.deleteStalePendingNewsletter(cutoff(now, NEWSLETTER_PENDING_RETENTION_DAYS), limit);
      const anonymized = await repo.anonymizeUnsubscribedNewsletter(
        cutoff(now, NEWSLETTER_UNSUBSCRIBED_RETENTION_DAYS),
        now,
        limit
      );
      return deleted + anonymized;
    },

    /** Trilha de auditoria e registros técnicos de pagamento com mais de um ano. */
    async housekeeping({ now = new Date(), limit = DEFAULT_LIMIT }: RetentionInput = {}): Promise<number> {
      const audit = await repo.deleteAuditEvents(cutoff(now, AUDIT_RETENTION_DAYS), limit);
      const webhooks = await repo.deleteFinishedWebhookEvents(cutoff(now, WEBHOOK_RETENTION_DAYS), limit);
      return audit + webhooks;
    },
  };
}
