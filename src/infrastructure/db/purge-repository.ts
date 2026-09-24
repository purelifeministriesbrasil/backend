// src/infrastructure/db/purge-repository.ts (§5.5)
import { eq, and, lt, ne } from "drizzle-orm";
import type { PurgeRepository } from "../../application/usecases/purge-triage.js";
import { triageSubmissions } from "./schema.js";

export function createDrizzlePurgeRepository(db: any): PurgeRepository {
  return {
    async findExpiredSubmissions(asOfDate: Date): Promise<string[]> {
      const rows = await db
        .select({ id: triageSubmissions.id })
        .from(triageSubmissions)
        .where(
          and(
            lt(triageSubmissions.retentionUntil, asOfDate),
            ne(triageSubmissions.status, "purged")
          )
        );

      return rows.map((r: any) => r.id);
    },

    async purgeSubmission(id: string, params): Promise<boolean> {
      // Nulifica todos os dados identificáveis em cumprimento estrito à CHECK (triage_purged_clean)
      const res = await db
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
          updatedAt: new Date(),
        })
        .where(eq(triageSubmissions.id, id));

      return true;
    },
  };
}
