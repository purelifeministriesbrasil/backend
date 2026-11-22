import { and, eq, gt, inArray } from "drizzle-orm";
import type { NewsletterRepository } from "../../application/ports/newsletter-repository.js";
import type { EncryptionProvider } from "../../application/ports/encryption-provider.js";
import type { KeyedHasher } from "../crypto/hashing.js";
import type { Database } from "./db.js";
import { newsletterSubscriptions } from "./schema.js";

/** Estados que aceitam (re)envio de confirmação. bounced/suppressed protegem a reputação do domínio. */
const RESUBSCRIBABLE = new Set(["pending", "unsubscribed"]);

export function createDrizzleNewsletterRepository(
  db: Pick<Database, "transaction" | "update">,
  enc: EncryptionProvider,
  hashEmail: KeyedHasher
): NewsletterRepository {
  return {
    async upsertPending({
      email,
      policyVersion,
      consentedAt,
      confirmTokenHash,
      confirmExpiresAt,
      unsubscribeTokenHash,
      unsubscribeExpiresAt,
      resendCooldownSeconds,
      now,
    }) {
      const emailHash = await hashEmail(email);

      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            id: newsletterSubscriptions.id,
            status: newsletterSubscriptions.status,
            confirmSentAt: newsletterSubscriptions.confirmSentAt,
            purgedAt: newsletterSubscriptions.purgedAt,
          })
          .from(newsletterSubscriptions)
          .where(eq(newsletterSubscriptions.emailHash, emailHash))
          .for("update");

        if (!existing) {
          const id = crypto.randomUUID();
          const cipher = await enc.encrypt(email, { entityType: "newsletter_subscription", entityId: id, field: "email" });
          const [row] = await tx
            .insert(newsletterSubscriptions)
            .values({
              id,
              emailHash,
              emailCipher: cipher.ciphertext,
              emailIv: cipher.iv,
              keyVersion: cipher.keyVersion,
              status: "pending",
              confirmTokenHash,
              confirmExpiresAt,
              unsubscribeTokenHash,
              unsubscribeExpiresAt,
              confirmSentAt: now,
              policyVersion,
              consentedAt,
            })
            .onConflictDoNothing({ target: newsletterSubscriptions.emailHash })
            .returning({ id: newsletterSubscriptions.id });
          return row ? { kind: "confirmation_required" as const } : { kind: "no_action" as const };
        }

        if (!RESUBSCRIBABLE.has(existing.status)) return { kind: "no_action" as const };

        const cooldownEndsAt = existing.confirmSentAt
          ? existing.confirmSentAt.getTime() + resendCooldownSeconds * 1000
          : 0;
        if (cooldownEndsAt > now.getTime()) return { kind: "no_action" as const };

        // Linha anonimizada pela retenção (só email_hash): quem se inscreve de novo reabre o consentimento, então o
        // e-mail volta a ser guardado cifrado, como em uma inscrição nova.
        const restored = existing.purgedAt
          ? await enc.encrypt(email, { entityType: "newsletter_subscription", entityId: existing.id, field: "email" })
          : null;

        await tx
          .update(newsletterSubscriptions)
          .set({
            ...(restored
              ? { emailCipher: restored.ciphertext, emailIv: restored.iv, keyVersion: restored.keyVersion, purgedAt: null }
              : {}),
            status: "pending",
            confirmTokenHash,
            confirmExpiresAt,
            unsubscribeTokenHash,
            unsubscribeExpiresAt,
            confirmSentAt: now,
            policyVersion,
            consentedAt,
            unsubscribedAt: null,
          })
          .where(eq(newsletterSubscriptions.id, existing.id));
        return { kind: "confirmation_required" as const };
      });
    },

    async confirm(confirmTokenHash, now) {
      const rows = await db
        .update(newsletterSubscriptions)
        .set({ status: "confirmed", confirmedAt: now, confirmTokenHash: null, confirmExpiresAt: null })
        .where(
          and(
            eq(newsletterSubscriptions.confirmTokenHash, confirmTokenHash),
            eq(newsletterSubscriptions.status, "pending"),
            gt(newsletterSubscriptions.confirmExpiresAt, now)
          )
        )
        .returning({ id: newsletterSubscriptions.id });
      return rows.length > 0;
    },

    async unsubscribe(unsubscribeTokenHash, now) {
      const rows = await db
        .update(newsletterSubscriptions)
        .set({
          status: "unsubscribed",
          unsubscribedAt: now,
          unsubscribeTokenHash: null,
          unsubscribeExpiresAt: null,
          confirmTokenHash: null,
          confirmExpiresAt: null,
        })
        .where(
          and(
            eq(newsletterSubscriptions.unsubscribeTokenHash, unsubscribeTokenHash),
            inArray(newsletterSubscriptions.status, ["pending", "confirmed"]),
            gt(newsletterSubscriptions.unsubscribeExpiresAt, now)
          )
        )
        .returning({ id: newsletterSubscriptions.id });
      return rows.length > 0;
    },
  };
}
