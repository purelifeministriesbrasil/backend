// src/infrastructure/db/purge-repository.ts (§5.5)
import { and, eq, isNull, lt, ne } from "drizzle-orm";
import type { PurgeRepository } from "../../application/usecases/purge-triage.js";
import type { ContactPurgeRepository } from "../../application/usecases/purge-contacts.js";
import type { Database } from "./db.js";
import { contactSubmissions, triageSubmissions } from "./schema.js";

export function createDrizzlePurgeRepository(
  db: Pick<Database, "select" | "update">
): PurgeRepository & ContactPurgeRepository {
  return {
    async findExpiredSubmissions(asOfDate: Date, limit: number = 500): Promise<string[]> {
      const rows = await db
        .select({ id: triageSubmissions.id })
        .from(triageSubmissions)
        .where(and(lt(triageSubmissions.retentionUntil, asOfDate), isNull(triageSubmissions.purgedAt)))
        .limit(limit);
      return rows.map((r) => r.id);
    },

    async purgeSubmission(id, params): Promise<boolean> {
      // Nulifica todos os dados identificáveis em cumprimento estrito à CHECK (triage_purged_clean)
      const rows = await db
        .update(triageSubmissions)
        .set({
          status: "purged",
          referenceCode: null,
          programInterest: null,
          contactChannel: null,
          contactCiphertext: null,
          contactIv: null,
          reportCiphertext: null,
          reportIv: null,
          keyVersion: null,
          purgedAt: params.purgedAt,
          purgeReason: params.purgeReason,
          purgePolicyVersion: params.purgePolicyVersion,
        })
        .where(and(eq(triageSubmissions.id, id), ne(triageSubmissions.status, "purged")))
        .returning({ id: triageSubmissions.id });
      return rows.length > 0;
    },

    async findExpiredContacts(asOfDate, limit) {
      const rows = await db
        .select({ id: contactSubmissions.id })
        .from(contactSubmissions)
        .where(and(lt(contactSubmissions.retentionUntil, asOfDate), isNull(contactSubmissions.purgedAt)))
        .limit(limit);
      return rows.map((r) => r.id);
    },

    async purgeContact(id, purgedAt) {
      // Satisfaz a CHECK contact_purged_clean (0002): nenhum identificador sobrevive ao expurgo.
      const rows = await db
        .update(contactSubmissions)
        .set({
          status: "purged",
          referenceCode: null,
          contactCiphertext: null,
          contactIv: null,
          messageCiphertext: null,
          messageIv: null,
          keyVersion: null,
          purgedAt,
        })
        .where(and(eq(contactSubmissions.id, id), ne(contactSubmissions.status, "purged")))
        .returning({ id: contactSubmissions.id });
      return rows.length > 0;
    },
  };
}
