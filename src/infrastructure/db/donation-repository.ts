import { and, eq, sql } from "drizzle-orm";
import type {
  ChargeRepository,
  DonationRepository,
  StoredCharge,
} from "../../application/ports/donation-repository.js";
import type { EncryptionProvider } from "../../application/ports/encryption-provider.js";
import type { PaymentProviderName } from "../../application/ports/payment-gateway.js";
import type { ChargeStatus } from "../../domains/donations/state-machine.js";
import type { KeyedHasher } from "../crypto/hashing.js";
import type { Database } from "./db.js";
import { auditEvents, donationIntents, paymentCharges } from "./schema.js";

type ChargeRow = typeof paymentCharges.$inferSelect;

function toStoredCharge(row: ChargeRow): StoredCharge {
  return {
    chargeId: row.id,
    provider: row.provider as PaymentProviderName,
    providerChargeId: row.providerChargeId,
    amountCents: row.amountCents,
    status: row.status as ChargeStatus,
    pixCopyPaste: row.pixCopyPaste,
    expiresAt: row.expiresAt,
  };
}

export interface CreationLockOptions {
  /** Quanto tempo uma requisição espera pelo bloqueio da intenção (padrão 15 s). */
  lockTimeoutMs?: number;
  /**
   * Teto para a transação ficar ociosa (as chamadas ao gateway acontecem sob o bloqueio, sem comandos SQL).
   * Se o Worker morrer no meio, o Postgres encerra a sessão e libera o bloqueio e a conexão (padrão 60 s).
   */
  idleInTransactionTimeoutMs?: number;
}

export function createDrizzleDonationRepository(
  db: Pick<Database, "select" | "insert" | "transaction" | "execute">,
  enc: EncryptionProvider,
  hashEmail: KeyedHasher,
  lock: CreationLockOptions = {}
): DonationRepository {
  const lockTimeoutMs = Math.floor(lock.lockTimeoutMs ?? 15_000);
  const idleInTxMs = Math.floor(lock.idleInTransactionTimeoutMs ?? 60_000);
  async function firstCharge(intentId: string): Promise<StoredCharge | null> {
    const [row] = await db
      .select()
      .from(paymentCharges)
      .where(and(eq(paymentCharges.donationIntentId, intentId), eq(paymentCharges.attemptNumber, 1)));
    return row ? toStoredCharge(row) : null;
  }

  const repository: DonationRepository = {
    async findOrCreateIntent({ idempotencyKey, amountCents, frequency, donorEmail }) {
      const id = crypto.randomUUID();
      const emailFields = donorEmail
        ? await (async () => {
            const cipher = await enc.encrypt(donorEmail, { entityType: "donation_intent", entityId: id, field: "email" });
            return {
              donorEmailHash: await hashEmail(donorEmail),
              donorEmailCipher: cipher.ciphertext,
              donorEmailIv: cipher.iv,
              keyVersion: cipher.keyVersion,
            };
          })()
        : {};

      const [inserted] = await db
        .insert(donationIntents)
        .values({ id, idempotencyKey, amountCents, frequency, ...emailFields })
        .onConflictDoNothing({ target: donationIntents.idempotencyKey })
        .returning({ id: donationIntents.id });

      if (inserted) {
        return { intentId: inserted.id, amountCents, frequency, created: true, existingCharge: null };
      }

      const [existing] = await db
        .select({
          id: donationIntents.id,
          amountCents: donationIntents.amountCents,
          frequency: donationIntents.frequency,
        })
        .from(donationIntents)
        .where(eq(donationIntents.idempotencyKey, idempotencyKey));
      if (!existing) throw new Error("donation_idempotency_unresolved");

      return {
        intentId: existing.id,
        amountCents: existing.amountCents,
        frequency: existing.frequency as "one_time" | "monthly",
        created: false,
        existingCharge: await firstCharge(existing.id),
      };
    },

    findFirstCharge: firstCharge,

    async withCreationLock(intentId, work) {
      return db.transaction(async (tx) => {
        // Bloqueio consultivo da transação, liberado no commit/rollback. O timeout evita espera indefinida.
        await tx.execute(sql.raw(`SET LOCAL lock_timeout = ${lockTimeoutMs}`));
        await tx.execute(sql.raw(`SET LOCAL idle_in_transaction_session_timeout = ${idleInTxMs}`));
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`donation_intent:${intentId}`}, 0))`);
        return work(createDrizzleDonationRepository(tx, enc, hashEmail, lock));
      });
    },

    async saveFirstCharge({ intentId, provider, providerChargeId, amountCents, pixCopyPaste, expiresAt }) {
      const [row] = await db
        .insert(paymentCharges)
        .values({
          donationIntentId: intentId,
          attemptNumber: 1,
          provider,
          providerChargeId,
          method: "pix",
          amountCents,
          status: "pending",
          expiresAt,
          pixCopyPaste,
        })
        .onConflictDoNothing({ target: [paymentCharges.donationIntentId, paymentCharges.attemptNumber] })
        .returning();
      if (row) return toStoredCharge(row);

      const winner = await firstCharge(intentId);
      if (!winner) throw new Error("charge_insert_unresolved");
      return winner;
    },
  };
  return repository;
}

export function createDrizzleChargeRepository(db: Pick<Database, "select" | "update" | "insert">): ChargeRepository {
  return {
    async findByProviderChargeId(provider, providerChargeId) {
      const [row] = await db
        .select({ id: paymentCharges.id, status: paymentCharges.status, amountCents: paymentCharges.amountCents })
        .from(paymentCharges)
        .where(and(eq(paymentCharges.provider, provider), eq(paymentCharges.providerChargeId, providerChargeId)));
      return row ? { id: row.id, status: row.status as ChargeStatus, amountCents: row.amountCents } : null;
    },

    async transitionStatus(chargeId, from, to, at) {
      const rows = await db
        .update(paymentCharges)
        .set({ status: to, ...(to === "confirmed" ? { confirmedAt: at } : {}) })
        .where(and(eq(paymentCharges.id, chargeId), eq(paymentCharges.status, from)))
        .returning({ id: paymentCharges.id });
      return rows.length > 0;
    },

    async recordAudit(action, entityId, metadata) {
      await db.insert(auditEvents).values({
        actor: "system",
        action,
        entityType: "payment_charge",
        entityId,
        metadata,
      });
    },
  };
}
