import { sql, eq, and } from "drizzle-orm";
import type {
  EventIdempotencyRepository,
  WebhookClaimResult,
} from "../../application/ports/idempotency-repository.js";
import type { Database } from "./db.js";
import { paymentWebhookEvents } from "./schema.js";

interface ClaimRow {
  attempts: number;
  process_status: string;
  was_insert: boolean;
}

export function createIdempotencyRepository(db: Pick<Database, "execute" | "select" | "update">): EventIdempotencyRepository {
  const byEvent = (provider: string, eventId: string) =>
    and(eq(paymentWebhookEvents.provider, provider), eq(paymentWebhookEvents.eventId, eventId));

  return {
    async claimOrResume({ provider, eventId, eventType, signatureOk, now, leaseSeconds, maxAttempts }): Promise<WebhookClaimResult> {
      // INSERT ... ON CONFLICT DO UPDATE atômico (§8.3). Parâmetros com cast explícito:
      // sem prepared statements (pooler em modo transaction) o Postgres não infere tipos de `unknown`.
      const nowIso = now.toISOString();
      const rows = (await db.execute(sql`
        INSERT INTO payment_webhook_events
          (provider, event_id, event_type, signature_ok, attempts,
           process_status, processing_started_at, processing_lease_until)
        VALUES (${provider}::text, ${eventId}::text, ${eventType}::text, ${signatureOk}::boolean, 1, 'processing',
                ${nowIso}::timestamptz, ${nowIso}::timestamptz + make_interval(secs => ${leaseSeconds}::int))
        ON CONFLICT (provider, event_id) DO UPDATE
          SET attempts               = payment_webhook_events.attempts + 1,
              process_status         = 'processing',
              processing_started_at  = EXCLUDED.processing_started_at,
              processing_lease_until = EXCLUDED.processing_lease_until
          WHERE payment_webhook_events.process_status IN ('received', 'failed')
             OR (payment_webhook_events.process_status = 'processing'
                 AND payment_webhook_events.processing_lease_until < ${nowIso}::timestamptz)
        RETURNING attempts, process_status, (xmax = 0) AS was_insert
      `)) as unknown as ClaimRow[];

      const row = rows[0];
      if (row) {
        if (row.attempts > maxAttempts) {
          await db
            .update(paymentWebhookEvents)
            .set({ processStatus: "dead_letter" })
            .where(byEvent(provider, eventId));
          return { kind: "dead_letter" };
        }
        return row.was_insert ? { kind: "claimed" } : { kind: "resumed" };
      }

      // Nenhuma linha afetada: o evento existe em estado que não permite retomada.
      const [existing] = await db.select().from(paymentWebhookEvents).where(byEvent(provider, eventId));
      if (!existing) return { kind: "currently_processing" };
      if (existing.processStatus === "processed" || existing.processStatus === "ignored") {
        return { kind: "already_processed" };
      }
      if (existing.processStatus === "dead_letter") return { kind: "dead_letter" };
      return { kind: "currently_processing" };
    },

    async markProcessed(provider, eventId, chargeId) {
      await db
        .update(paymentWebhookEvents)
        .set({ processStatus: "processed", processedAt: new Date(), chargeId })
        .where(byEvent(provider, eventId));
    },

    async markIgnored(provider, eventId, reason) {
      await db
        .update(paymentWebhookEvents)
        .set({ processStatus: "ignored", processedAt: new Date(), lastErrorCode: reason })
        .where(byEvent(provider, eventId));
    },

    async markFailed(provider, eventId, errorCode) {
      await db
        .update(paymentWebhookEvents)
        .set({ processStatus: "failed", lastErrorCode: errorCode, lastErrorAt: new Date() })
        .where(byEvent(provider, eventId));
    },
  };
}
