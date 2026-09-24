import { eq } from "drizzle-orm";
import type { TriageUnitOfWork } from "../../application/ports/triage-unit-of-work.js";
import type { EncryptionProvider } from "../../application/ports/encryption-provider.js";
import { triageSubmissions, triageConsents } from "./schema.js";

// Helper para calcular o primeiro dia do mês (§5.3 - createdMonth)
function startOfMonth(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

// Database Transaction Interface compatível com Drizzle
export interface DbTransaction {
  insert: (table: any) => {
    values: (data: any) => {
      returning: (fields: any) => Promise<any[]>;
    } & Promise<any>;
  };
  update: (table: any) => {
    set: (data: any) => {
      where: (clause: any) => Promise<any>;
    };
  };
}

export interface DbClient {
  transaction: <T>(callback: (tx: DbTransaction) => Promise<T>) => Promise<T>;
}

export function createTriageUnitOfWork(
  db: DbClient,
  enc: EncryptionProvider
): TriageUnitOfWork {
  return {
    async createSubmissionWithConsent({ triage, consent, referenceCode }) {
      return db.transaction(async (tx) => {
        // 1. Insere registro preliminar na transação para obter o UUID real do AAD
        const [row] = await tx
          .insert(triageSubmissions)
          .values({
            referenceCode,
            programInterest: triage.programInterest,
            contactChannel: triage.contactChannel,
            createdMonth: startOfMonth(consent.grantedAt),
            retentionUntil: triage.retentionUntil,
          })
          .returning({ id: triageSubmissions.id });

        if (!row || !row.id) {
          throw new Error("triage_insert_failed_no_id");
        }

        // 2. Cifra de campo vinculada rigidamente à entidade, campo e versão da chave via AAD (§5.2)
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

        // Atualiza campos cifrados dentro da mesma transação
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

        // 3. Grava consentimento com chave estrangeira real na MESMA transação atômica (§5.4)
        await tx.insert(triageConsents).values({
          triageSubmissionId: row.id,
          purpose: consent.purpose,
          policyVersion: consent.policyVersion,
          grantedAt: consent.grantedAt,
          originRoute: consent.originRoute,
        });

        return { submissionId: row.id };
      });
    },
  };
}
