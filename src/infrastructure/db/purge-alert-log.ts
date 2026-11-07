import { and, eq, gt, sql } from "drizzle-orm";
import type { PurgeAlertLog } from "../../application/ports/purge-alert-log.js";
import type { Database } from "./db.js";
import { auditEvents } from "./schema.js";

const ALERT_ACTION = "purge.alert_sent";

/** Persiste os alertas em `audit_events` (sem migration): ator `system`, só etapa e referência em `metadata`. */
export function createDrizzlePurgeAlertLog(db: Pick<Database, "select" | "insert">): PurgeAlertLog {
  return {
    async hasAlertSince(step, since) {
      const rows = await db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, ALERT_ACTION),
            gt(auditEvents.createdAt, since),
            sql`${auditEvents.metadata}->>'step' = ${step}`
          )
        )
        .limit(1);
      return rows.length > 0;
    },

    async recordAlert(step, reference, at) {
      await db.insert(auditEvents).values({
        actor: "system",
        actorRole: "cron",
        action: ALERT_ACTION,
        entityType: "purge",
        metadata: { step, reference },
        createdAt: at,
      });
    },
  };
}
