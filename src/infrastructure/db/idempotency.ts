import { sql, eq, and } from "drizzle-orm";
import type {
  EventIdempotencyRepository,
  WebhookClaimResult,
} from "../../application/ports/idempotency-repository.js";
import { paymentWebhookEvents } from "./schema.js";

export function createIdempotencyRepository(db: any): EventIdempotencyRepository {
  return {
    async claimOrResume({
      provider,
      eventId,
      eventType,
      signatureOk,
      now,
      leaseSeconds,
      maxAttempts,
    }): Promise<WebhookClaimResult> {
      // 1. Executa instrução atômica INSERT ... ON CONFLICT DO UPDATE (§8.3)
      const query = sql`
        INSERT INTO payment_webhook_events
          (provider, event_id, event_type, signature_ok, attempts,
           process_status, processing_started_at, processing_lease_until)
        VALUES (${provider}, ${eventId}, ${eventType}, ${signatureOk}, 1, 'processing', ${now}, ${now} + (${leaseSeconds} || ' seconds')::interval)
        ON CONFLICT (provider, event_id) DO UPDATE
          SET attempts               = payment_webhook_events.attempts + 1,
              process_status         = 'processing',
              processing_started_at  = ${now},
              processing_lease_until = ${now} + (${leaseSeconds} || ' seconds')::interval
          WHERE payment_webhook_events.process_status IN ('received', 'failed')
             OR (payment_webhook_events.process_status = 'processing'
                 AND payment_webhook_events.processing_lease_until < ${now})
        RETURNING attempts, process_status, (xmax = 0) AS was_insert;
      `;

      const result = await db.execute(query);
      const rows = result.rows || result;

      if (rows && rows.length > 0) {
        const row = rows[0];
        if (row.attempts > maxAttempts) {
          await db
            .update(paymentWebhookEvents)
            .set({ processStatus: "dead_letter" })
            .where(
              and(
                eq(paymentWebhookEvents.provider, provider),
                eq(paymentWebhookEvents.eventId, eventId)
              )
            );
          return { kind: "dead_letter" };
        }
        return row.was_insert ? { kind: "claimed" } : { kind: "resumed" };
      }

      // Se zero linhas foram afetadas, inspeciona o estado atual do evento existente
      const existingRows = await db
        .select()
        .from(paymentWebhookEvents)
        .where(
          and(
            eq(paymentWebhookEvents.provider, provider),
            eq(paymentWebhookEvents.eventId, eventId)
          )
        );

      if (!existingRows || existingRows.length === 0) {
        return { kind: "claimed" };
      }

      const existing = existingRows[0];
      if (existing.attempts >= maxAttempts) {
        return { kind: "dead_letter" };
      }

      if (existing.processStatus === "processed" || existing.processStatus === "ignored") {
        return { kind: "already_processed" };
      }

      if (
        existing.processStatus === "processing" &&
        existing.processingLeaseUntil &&
        new Date(existing.processingLeaseUntil) >= now
      ) {
        return { kind: "currently_processing" };
      }

      return { kind: "resumed" };
    },

    async markProcessed(provider, eventId, chargeId) {
      await db
        .update(paymentWebhookEvents)
        .set({
          processStatus: "processed",
          processedAt: new Date(),
          chargeId,
        })
        .where(
          and(
            eq(paymentWebhookEvents.provider, provider),
            eq(paymentWebhookEvents.eventId, eventId)
          )
        );
    },

    async markIgnored(provider, eventId, reason) {
      await db
        .update(paymentWebhookEvents)
        .set({
          processStatus: "ignored",
          lastErrorCode: reason,
        })
        .where(
          and(
            eq(paymentWebhookEvents.provider, provider),
            eq(paymentWebhookEvents.eventId, eventId)
          )
        );
    },

    async markFailed(provider, eventId, errorCode) {
      await db
        .update(paymentWebhookEvents)
        .set({
          processStatus: "failed",
          lastErrorCode: errorCode,
          lastErrorAt: new Date(),
        })
        .where(
          and(
            eq(paymentWebhookEvents.provider, provider),
            eq(paymentWebhookEvents.eventId, eventId)
          )
        );
    },
  };
}
