import { eq } from "drizzle-orm";
import type { ContactRepository } from "../../application/ports/contact-repository.js";
import type { EncryptionProvider } from "../../application/ports/encryption-provider.js";
import type { Database } from "./db.js";
import { contactSubmissions, contactConsents } from "./schema.js";

export function createDrizzleContactRepository(
  db: Pick<Database, "transaction">,
  enc: EncryptionProvider
): ContactRepository {
  return {
    async createWithConsent({ contact, consent, referenceCode, idempotencyKey }) {
      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: contactSubmissions.id, referenceCode: contactSubmissions.referenceCode })
          .from(contactSubmissions)
          .where(eq(contactSubmissions.idempotencyKey, idempotencyKey));
        if (existing?.referenceCode) {
          return { submissionId: existing.id, referenceCode: existing.referenceCode, created: false };
        }

        // UUID gerado antes do INSERT: o AAD já nasce vinculado ao id definitivo (um único INSERT).
        const id = crypto.randomUUID();
        const contactEncrypted = await enc.encrypt(contact.contactPlaintext, {
          entityType: "contact_submission",
          entityId: id,
          field: "contact",
        });
        const messageEncrypted = await enc.encrypt(contact.messagePlaintext, {
          entityType: "contact_submission",
          entityId: id,
          field: "message",
        });

        const [row] = await tx
          .insert(contactSubmissions)
          .values({
            id,
            referenceCode,
            idempotencyKey,
            subject: contact.subject,
            contactCiphertext: contactEncrypted.ciphertext,
            contactIv: contactEncrypted.iv,
            messageCiphertext: messageEncrypted.ciphertext,
            messageIv: messageEncrypted.iv,
            keyVersion: contactEncrypted.keyVersion,
            retentionUntil: contact.retentionUntil,
          })
          .onConflictDoNothing({ target: contactSubmissions.idempotencyKey })
          .returning({ id: contactSubmissions.id });

        if (!row) {
          // Corrida com outra requisição de mesma chave que já comitou.
          const [winner] = await tx
            .select({ id: contactSubmissions.id, referenceCode: contactSubmissions.referenceCode })
            .from(contactSubmissions)
            .where(eq(contactSubmissions.idempotencyKey, idempotencyKey));
          if (!winner?.referenceCode) throw new Error("contact_idempotency_unresolved");
          return { submissionId: winner.id, referenceCode: winner.referenceCode, created: false };
        }

        await tx.insert(contactConsents).values({
          contactSubmissionId: row.id,
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
