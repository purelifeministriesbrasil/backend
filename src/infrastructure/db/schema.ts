// Espelho tipado de drizzle/0001_initial.sql + drizzle/0002_supabase_hardening_and_rls.sql.
// A fonte de verdade é o SQL versionado em drizzle/; este arquivo deve acompanhá-lo coluna a coluna.
import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  smallint,
  integer,
  boolean,
  timestamp,
  date,
  char,
  jsonb,
  uniqueIndex,
  index,
  check,
  unique,
  foreignKey,
} from "drizzle-orm/pg-core";

// ───────── Triagem (§5.3) ─────────
export const triageSubmissions = pgTable(
  "triage_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referenceCode: text("reference_code").unique("triage_submissions_reference_code_key"),
    programInterest: text("program_interest"),
    contactChannel: text("contact_channel"),
    status: text("status").notNull().default("received"),

    contactCiphertext: text("contact_ciphertext"),
    contactIv: text("contact_iv"),
    reportCiphertext: text("report_ciphertext"),
    reportIv: text("report_iv"),
    keyVersion: smallint("key_version"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdMonth: date("created_month").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    retentionUntil: timestamp("retention_until", { withTimezone: true }).notNull(),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    purgeReason: text("purge_reason"),
    purgePolicyVersion: text("purge_policy_version"),
    idempotencyKey: uuid("idempotency_key"),
  },
  (table) => [
    index("triage_status_created_idx").on(table.status, sql`${table.createdAt} DESC`),
    index("triage_retention_idx").on(table.retentionUntil).where(sql`${table.purgedAt} IS NULL`),
    uniqueIndex("triage_idempotency_unq").on(table.idempotencyKey),
    check("triage_status_chk", sql`${table.status} IN ('received','in_review','contacted','closed','purged')`),
    check(
      "triage_program_chk",
      sql`${table.programInterest} IS NULL OR ${table.programInterest} IN ('residencial','online','esposas','indefinido')`
    ),
    check(
      "triage_channel_chk",
      sql`${table.contactChannel} IS NULL OR ${table.contactChannel} IN ('email','telefone','whatsapp')`
    ),
    check(
      "triage_purged_clean",
      sql`${table.status} <> 'purged' OR (${table.referenceCode} IS NULL AND ${table.contactCiphertext} IS NULL AND ${table.reportCiphertext} IS NULL AND ${table.contactIv} IS NULL AND ${table.reportIv} IS NULL AND ${table.contactChannel} IS NULL)`
    ),
  ]
).enableRLS();

// ───────── Consentimento de Triagem (§5.3 e §5.4) ─────────
export const triageConsents = pgTable(
  "triage_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    triageSubmissionId: uuid("triage_submission_id").notNull(),
    purpose: text("purpose").notNull(),
    policyVersion: text("policy_version").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
    originRoute: text("origin_route").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [foreignKey({ name: "triage_consents_triage_submission_id_fkey", columns: [table.triageSubmissionId], foreignColumns: [triageSubmissions.id] }).onDelete("restrict"),
    uniqueIndex("triage_consent_unq").on(table.triageSubmissionId, table.purpose),
  ]
).enableRLS();

// ───────── Contato Institucional ─────────
export const contactSubmissions = pgTable(
  "contact_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referenceCode: text("reference_code").unique("contact_submissions_reference_code_key"),
    subject: text("subject").notNull(),
    contactCiphertext: text("contact_ciphertext"),
    contactIv: text("contact_iv"),
    messageCiphertext: text("message_ciphertext"),
    messageIv: text("message_iv"),
    keyVersion: smallint("key_version"),
    status: text("status").notNull().default("received"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    retentionUntil: timestamp("retention_until", { withTimezone: true }).notNull(),
    purgedAt: timestamp("purged_at", { withTimezone: true }),
    idempotencyKey: uuid("idempotency_key"),
  },
  (table) => [
    index("contact_retention_idx").on(table.retentionUntil).where(sql`${table.purgedAt} IS NULL`),
    index("contact_status_created_idx").on(table.status, sql`${table.createdAt} DESC`),
    uniqueIndex("contact_idempotency_unq").on(table.idempotencyKey),
    check("contact_status_chk", sql`${table.status} IN ('received','answered','closed','purged')`),
    check(
      "contact_purged_clean",
      sql`${table.status} <> 'purged' OR (${table.referenceCode} IS NULL AND ${table.contactCiphertext} IS NULL AND ${table.contactIv} IS NULL AND ${table.messageCiphertext} IS NULL AND ${table.messageIv} IS NULL)`
    ),
    check(
      "contact_cipher_present",
      sql`${table.status} = 'purged' OR (${table.contactCiphertext} IS NOT NULL AND ${table.contactIv} IS NOT NULL AND ${table.messageCiphertext} IS NOT NULL AND ${table.messageIv} IS NOT NULL AND ${table.keyVersion} IS NOT NULL)`
    ),
  ]
).enableRLS();

export const contactConsents = pgTable(
  "contact_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactSubmissionId: uuid("contact_submission_id").notNull(),
    purpose: text("purpose").notNull(),
    policyVersion: text("policy_version").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
    originRoute: text("origin_route").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [foreignKey({ name: "contact_consents_contact_submission_id_fkey", columns: [table.contactSubmissionId], foreignColumns: [contactSubmissions.id] }).onDelete("restrict"),
    uniqueIndex("contact_consent_unq").on(table.contactSubmissionId, table.purpose),
  ]
).enableRLS();

// ───────── Doação: Intenção × Cobrança (§5.3 e §8.4) ─────────
export const donationIntents = pgTable(
  "donation_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    amountCents: integer("amount_cents").notNull(),
    currency: char("currency", { length: 3 }).notNull().default("BRL"),
    frequency: text("frequency").notNull(),
    donorEmailHash: text("donor_email_hash"),
    donorEmailCipher: text("donor_email_cipher"),
    donorEmailIv: text("donor_email_iv"),
    keyVersion: smallint("key_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: uuid("idempotency_key"),
  },
  (table) => [
    index("intent_email_hash_idx").on(table.donorEmailHash),
    uniqueIndex("intent_idempotency_unq").on(table.idempotencyKey),
    check("intent_amount_chk", sql`${table.amountCents} BETWEEN 500 AND 5000000`),
    check("intent_freq_chk", sql`${table.frequency} IN ('one_time','monthly')`),
  ]
).enableRLS();

export const paymentCharges = pgTable(
  "payment_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    donationIntentId: uuid("donation_intent_id").notNull(),
    attemptNumber: smallint("attempt_number").notNull().default(1),
    provider: text("provider").notNull(),
    providerChargeId: text("provider_charge_id").notNull(),
    method: text("method").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    pixCopyPaste: text("pix_copy_paste"),
  },
  (table) => [
    foreignKey({ name: "payment_charges_donation_intent_id_fkey", columns: [table.donationIntentId], foreignColumns: [donationIntents.id] }).onDelete("restrict"),
    unique("charge_provider_unq").on(table.provider, table.providerChargeId),
    unique("charge_attempt_unq").on(table.donationIntentId, table.attemptNumber),
    index("charge_status_created_idx").on(table.status, sql`${table.createdAt} DESC`),
    index("charge_intent_idx").on(table.donationIntentId),
    check(
      "charge_status_chk",
      sql`${table.status} IN ('pending','confirmed','failed','refunded','cancelled','expired')`
    ),
    check("charge_method_chk", sql`${table.method} IN ('pix')`),
  ]
).enableRLS();

// ───────── Idempotência e Lease de Webhook (§5.3 e §8.3) ─────────
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    chargeId: uuid("charge_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processStatus: text("process_status").notNull().default("received"),
    signatureOk: boolean("signature_ok").notNull(),
    attempts: smallint("attempts").notNull().default(0),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    processingLeaseUntil: timestamp("processing_lease_until", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({ name: "payment_webhook_events_charge_id_fkey", columns: [table.chargeId], foreignColumns: [paymentCharges.id] }).onDelete("set null"),
    unique("webhook_idempotency_unq").on(table.provider, table.eventId),
    index("webhook_retry_idx")
      .on(table.processStatus, table.processingLeaseUntil)
      .where(sql`${table.processStatus} IN ('received','processing','failed')`),
    index("webhook_charge_idx").on(table.chargeId),
    check(
      "webhook_status_chk",
      sql`${table.processStatus} IN ('received','processing','processed','ignored','failed','dead_letter')`
    ),
  ]
).enableRLS();

// ───────── Newsletter ─────────
export const newsletterSubscriptions = pgTable(
  "newsletter_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    emailHash: text("email_hash").notNull().unique("newsletter_subscriptions_email_hash_key"),
    emailCipher: text("email_cipher").notNull(),
    emailIv: text("email_iv").notNull(),
    keyVersion: smallint("key_version").notNull(),
    status: text("status").notNull().default("pending"),
    confirmTokenHash: text("confirm_token_hash"),
    confirmExpiresAt: timestamp("confirm_expires_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    bounceCount: smallint("bounce_count").notNull().default(0),
    suppressedAt: timestamp("suppressed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    policyVersion: text("policy_version"),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    confirmSentAt: timestamp("confirm_sent_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("news_confirm_token_unq")
      .on(table.confirmTokenHash)
      .where(sql`${table.confirmTokenHash} IS NOT NULL`),
    check(
      "news_status_chk",
      sql`${table.status} IN ('pending','confirmed','unsubscribed','bounced','suppressed')`
    ),
  ]
).enableRLS();

// ───────── Auditoria (§5.3 e §6.3) ─────────
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actor: text("actor").notNull(),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    reason: text("reason"),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    ipHash: text("ip_hash"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_entity_idx").on(table.entityType, table.entityId, sql`${table.createdAt} DESC`),
    index("audit_actor_idx").on(table.actor, sql`${table.createdAt} DESC`),
  ]
).enableRLS();
