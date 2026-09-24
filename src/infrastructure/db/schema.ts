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
} from "drizzle-orm/pg-core";

// ───────── Triagem (§5.3) ─────────
export const triageSubmissions = pgTable(
  "triage_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referenceCode: text("reference_code").unique(),
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
  },
  (table) => [
    index("triage_status_created_idx").on(table.status, table.createdAt),
    index("triage_retention_idx").on(table.retentionUntil),
  ]
);

// ───────── Consentimento de Triagem (§5.3 e §5.4) ─────────
export const triageConsents = pgTable(
  "triage_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    triageSubmissionId: uuid("triage_submission_id")
      .notNull()
      .references(() => triageSubmissions.id, { onDelete: "restrict" }),
    purpose: text("purpose").notNull(),
    policyVersion: text("policy_version").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
    originRoute: text("origin_route").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("triage_consent_unq").on(table.triageSubmissionId, table.purpose),
  ]
);

// ───────── Contato Institucional ─────────
export const contactSubmissions = pgTable("contact_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  referenceCode: text("reference_code").unique(),
  subject: text("subject").notNull(),
  contactCiphertext: text("contact_ciphertext").notNull(),
  contactIv: text("contact_iv").notNull(),
  messageCiphertext: text("message_ciphertext").notNull(),
  messageIv: text("message_iv").notNull(),
  keyVersion: smallint("key_version").notNull(),
  status: text("status").notNull().default("received"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  retentionUntil: timestamp("retention_until", { withTimezone: true }).notNull(),
  purgedAt: timestamp("purged_at", { withTimezone: true }),
});

export const contactConsents = pgTable("contact_consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactSubmissionId: uuid("contact_submission_id")
    .notNull()
    .references(() => contactSubmissions.id, { onDelete: "restrict" }),
  purpose: text("purpose").notNull(),
  policyVersion: text("policy_version").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
  originRoute: text("origin_route").notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

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
  },
  (table) => [index("intent_email_hash_idx").on(table.donorEmailHash)]
);

export const paymentCharges = pgTable(
  "payment_charges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    donationIntentId: uuid("donation_intent_id")
      .notNull()
      .references(() => donationIntents.id, { onDelete: "restrict" }),
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
  },
  (table) => [
    uniqueIndex("charge_provider_unq").on(table.provider, table.providerChargeId),
    uniqueIndex("charge_attempt_unq").on(table.donationIntentId, table.attemptNumber),
    index("charge_status_created_idx").on(table.status, table.createdAt),
  ]
);

// ───────── Idempotência e Lease de Webhook (§5.3 e §8.3) ─────────
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    chargeId: uuid("charge_id").references(() => paymentCharges.id, { onDelete: "set null" }),
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
    uniqueIndex("webhook_idempotency_unq").on(table.provider, table.eventId),
    index("webhook_retry_idx").on(table.processStatus, table.processingLeaseUntil),
  ]
);

// ───────── Newsletter ─────────
export const newsletterSubscriptions = pgTable("newsletter_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  emailHash: text("email_hash").notNull().unique(),
  emailCipher: text("email_cipher").notNull(),
  emailIv: text("email_iv").notNull(),
  keyVersion: smallint("key_version").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    index("audit_entity_idx").on(table.entityType, table.entityId, table.createdAt),
    index("audit_actor_idx").on(table.actor, table.createdAt),
  ]
);
