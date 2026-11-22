// src/infrastructure/db/retention-repository.ts (§5.5)
import { and, inArray, lt, isNull, sql } from "drizzle-orm";
import type { RetentionRepository } from "../../application/ports/retention-repository.js";
import type { Database } from "./db.js";
import { auditEvents, newsletterSubscriptions, paymentWebhookEvents } from "./schema.js";

export function createDrizzleRetentionRepository(
  db: Pick<Database, "select" | "update" | "delete">
): RetentionRepository {
  return {
    async deleteStalePendingNewsletter(olderThan, limit) {
      // Última solicitação de confirmação (ou criação, se nunca houve reenvio). O link expira em 48 h, muito
      // antes do prazo, então a linha já não pode ser confirmada quando é apagada.
      const lastRequest = sql`COALESCE(${newsletterSubscriptions.confirmSentAt}, ${newsletterSubscriptions.createdAt})`;
      const rows = await db
        .select({ id: newsletterSubscriptions.id })
        .from(newsletterSubscriptions)
        .where(and(sql`${newsletterSubscriptions.status} = 'pending'`, sql`${lastRequest} < ${olderThan.toISOString()}`))
        .limit(limit);
      if (rows.length === 0) return 0;
      const deleted = await db
        .delete(newsletterSubscriptions)
        .where(
          and(
            inArray(
              newsletterSubscriptions.id,
              rows.map((r) => r.id)
            ),
            sql`${newsletterSubscriptions.status} = 'pending'`
          )
        )
        .returning({ id: newsletterSubscriptions.id });
      return deleted.length;
    },

    async anonymizeUnsubscribedNewsletter(olderThan, purgedAt, limit) {
      const rows = await db
        .select({ id: newsletterSubscriptions.id })
        .from(newsletterSubscriptions)
        .where(
          and(
            sql`${newsletterSubscriptions.status} = 'unsubscribed'`,
            lt(newsletterSubscriptions.unsubscribedAt, olderThan),
            isNull(newsletterSubscriptions.purgedAt)
          )
        )
        .limit(limit);
      if (rows.length === 0) return 0;
      // Satisfaz a CHECK news_purged_clean (0004): só o hash do e-mail sobrevive.
      const updated = await db
        .update(newsletterSubscriptions)
        .set({
          emailCipher: null,
          emailIv: null,
          keyVersion: null,
          confirmTokenHash: null,
          confirmExpiresAt: null,
          unsubscribeTokenHash: null,
          unsubscribeExpiresAt: null,
          purgedAt,
        })
        .where(
          and(
            inArray(
              newsletterSubscriptions.id,
              rows.map((r) => r.id)
            ),
            sql`${newsletterSubscriptions.status} = 'unsubscribed'`,
            isNull(newsletterSubscriptions.purgedAt)
          )
        )
        .returning({ id: newsletterSubscriptions.id });
      return updated.length;
    },

    async deleteAuditEvents(olderThan, limit) {
      const rows = await db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(lt(auditEvents.createdAt, olderThan))
        .limit(limit);
      if (rows.length === 0) return 0;
      const deleted = await db
        .delete(auditEvents)
        .where(
          inArray(
            auditEvents.id,
            rows.map((r) => r.id)
          )
        )
        .returning({ id: auditEvents.id });
      return deleted.length;
    },

    async deleteFinishedWebhookEvents(olderThan, limit) {
      const rows = await db
        .select({ id: paymentWebhookEvents.id })
        .from(paymentWebhookEvents)
        .where(
          and(
            lt(paymentWebhookEvents.receivedAt, olderThan),
            inArray(paymentWebhookEvents.processStatus, ["processed", "ignored", "dead_letter"])
          )
        )
        .limit(limit);
      if (rows.length === 0) return 0;
      const deleted = await db
        .delete(paymentWebhookEvents)
        .where(
          inArray(
            paymentWebhookEvents.id,
            rows.map((r) => r.id)
          )
        )
        .returning({ id: paymentWebhookEvents.id });
      return deleted.length;
    },
  };
}
