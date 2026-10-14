import { eq } from "drizzle-orm";
import type { TriageUnitOfWork } from "../../application/ports/triage-unit-of-work.js";
import type { EncryptionProvider } from "../../application/ports/encryption-provider.js";
import type { Database } from "./db.js";
import { triageSubmissions, triageConsents } from "./schema.js";

// Helper para calcular o primeiro dia do mês (§5.3 - createdMonth)
export function startOfMonth(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export function createTriageUnitOfWork(
  db: Pick<Database, "transaction">,
  enc: EncryptionProvider
): TriageUnitOfWork {
  return {
    async createSubmissionWithConsent({ triage, consent, referenceCode, idempotencyKey }) {
      return db.transaction(async (tx) => {
        // 1. Insere registro preliminar para obter o UUID real usado no AAD.
        //    ON CONFLICT na idempotency_key: retentativa devolve o código já emitido.
        const [row] = await tx
          .insert(triageSubmissions)
          .values({
            referenceCode,
            idempotencyKey,
            programInterest: triage.programInterest,
            contactChannel: triage.contactChannel,
            createdMonth: startOfMonth(consent.grantedAt),
            retentionUntil: triage.retentionUntil,
          })
          .onConflictDoNothing({ target: triageSubmissions.idempotencyKey })
          .returning({ id: triageSubmissions.id });

        if (!row) {
          const [existing] = await tx
            .select({ id: triageSubmissions.id, referenceCode: triageSubmissions.referenceCode })
            .from(triageSubmissions)
            .where(eq(triageSubmissions.idempotencyKey, idempotencyKey));
          if (!existing?.referenceCode) throw new Error("triage_idempotency_unresolved");
          return { submissionId: existing.id, referenceCode: existing.referenceCode, created: false };
        }

        // 2. Cifra de campo vinculada à entidade, campo e versão da chave via AAD (§5.2)
        const contactEncrypted = await enc.encrypt(triage.contactPlaintext, {
          entityType: "triage_submission",
          entityId: row.id,
          field: "contact",
        });

        const reportEncrypted = triage.reportPlaintext
          ? await enc.encrypt(triage.reportPlaintext, {
              entityType: "triage_submission",
              entityId: row.id,
              field: "report",
            })
          : null;

        await tx
          .update(triageSubmissions)
          .set({
            contactCiphertext: contactEncrypted.ciphertext,
            contactIv: contactEncrypted.iv,
            reportCiphertext: reportEncrypted?.ciphertext ?? null,
            reportIv: reportEncrypted?.iv ?? null,
            keyVersion: contactEncrypted.keyVersion,
          })
          .where(eq(triageSubmissions.id, row.id));

        // 3. Consentimento com chave estrangeira real na MESMA transação atômica (§5.4)
        await tx.insert(triageConsents).values({
          triageSubmissionId: row.id,
          purpose: consent.purpose,
          policyVersion: consent.policyVersion,
          grantedAt: consent.grantedAt,
          originRoute: consent.originRoute,
        });

        return { submissionId: row.id, referenceCode, created: true };
      });
    },
  };
}
