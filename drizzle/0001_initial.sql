-- drizzle/0001_initial.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ───────── Triagem ─────────
CREATE TABLE triage_submissions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code     TEXT UNIQUE,                    -- NULL após expurgo
  program_interest   TEXT,                           -- NULL após expurgo
  contact_channel    TEXT,                           -- NULL após expurgo
  status             TEXT NOT NULL DEFAULT 'received',

  contact_ciphertext TEXT, contact_iv TEXT,
  report_ciphertext  TEXT, report_iv  TEXT,
  key_version        SMALLINT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_month      DATE NOT NULL,                  -- sobrevive ao expurgo, para métrica
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  retention_until    TIMESTAMPTZ NOT NULL,
  purged_at          TIMESTAMPTZ,
  purge_reason       TEXT,
  purge_policy_version TEXT,

  CONSTRAINT triage_status_chk  CHECK (status IN ('received','in_review','contacted','closed','purged')),
  CONSTRAINT triage_program_chk CHECK (program_interest IS NULL OR program_interest IN ('residencial','online','esposas','indefinido')),
  CONSTRAINT triage_channel_chk CHECK (contact_channel IS NULL OR contact_channel IN ('email','telefone','whatsapp')),
  -- registro purgado não pode conservar identificadores
  CONSTRAINT triage_purged_clean CHECK (
    status <> 'purged' OR (
      reference_code IS NULL AND contact_ciphertext IS NULL AND report_ciphertext IS NULL
      AND contact_iv IS NULL AND report_iv IS NULL AND contact_channel IS NULL
    )
  )
);

CREATE INDEX triage_status_created_idx ON triage_submissions (status, created_at DESC);
CREATE INDEX triage_retention_idx      ON triage_submissions (retention_until) WHERE purged_at IS NULL;

-- ───────── Consentimento de triagem (FK real) ─────────
CREATE TABLE triage_consents (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triage_submission_id UUID NOT NULL REFERENCES triage_submissions(id) ON DELETE RESTRICT,
  purpose              TEXT NOT NULL,
  policy_version       TEXT NOT NULL,
  granted_at           TIMESTAMPTZ NOT NULL,
  origin_route         TEXT NOT NULL,
  revoked_at           TIMESTAMPTZ
);
CREATE UNIQUE INDEX triage_consent_unq ON triage_consents (triage_submission_id, purpose);

-- ───────── Contato institucional ─────────
CREATE TABLE contact_submissions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code     TEXT UNIQUE,
  subject            TEXT NOT NULL,
  contact_ciphertext TEXT NOT NULL, contact_iv TEXT NOT NULL,
  message_ciphertext TEXT NOT NULL, message_iv TEXT NOT NULL,
  key_version        SMALLINT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'received',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  retention_until    TIMESTAMPTZ NOT NULL,
  purged_at          TIMESTAMPTZ,
  CONSTRAINT contact_status_chk CHECK (status IN ('received','answered','closed','purged'))
);
CREATE TABLE contact_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_submission_id UUID NOT NULL REFERENCES contact_submissions(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL, policy_version TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL, origin_route TEXT NOT NULL, revoked_at TIMESTAMPTZ
);

-- ───────── Doação: intenção × cobrança ─────────
CREATE TABLE donation_intents (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_cents       INTEGER NOT NULL,
  currency           CHAR(3) NOT NULL DEFAULT 'BRL',
  frequency          TEXT NOT NULL,
  donor_email_hash   TEXT,          -- SHA-256 com pepper; conciliação sem PII
  donor_email_cipher TEXT, donor_email_iv TEXT, key_version SMALLINT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT intent_amount_chk CHECK (amount_cents BETWEEN 500 AND 5000000),
  CONSTRAINT intent_freq_chk   CHECK (frequency IN ('one_time','monthly'))
);
CREATE INDEX intent_email_hash_idx ON donation_intents (donor_email_hash);

CREATE TABLE payment_charges (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_intent_id UUID NOT NULL REFERENCES donation_intents(id) ON DELETE RESTRICT,
  attempt_number     SMALLINT NOT NULL DEFAULT 1,
  provider           TEXT NOT NULL,
  provider_charge_id TEXT NOT NULL,
  method             TEXT NOT NULL,
  amount_cents       INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',
  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at       TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT charge_status_chk   CHECK (status IN ('pending','confirmed','failed','refunded','cancelled','expired')),
  CONSTRAINT charge_method_chk   CHECK (method IN ('pix')),          -- v1: só Pix
  CONSTRAINT charge_provider_unq UNIQUE (provider, provider_charge_id),
  CONSTRAINT charge_attempt_unq  UNIQUE (donation_intent_id, attempt_number)
);
CREATE INDEX charge_status_created_idx ON payment_charges (status, created_at DESC);

-- ───────── Idempotência e retry de webhook ─────────
CREATE TABLE payment_webhook_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              TEXT NOT NULL,
  event_id              TEXT NOT NULL,
  event_type            TEXT NOT NULL,
  charge_id             UUID REFERENCES payment_charges(id) ON DELETE SET NULL,
  occurred_at           TIMESTAMPTZ,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at          TIMESTAMPTZ,
  process_status        TEXT NOT NULL DEFAULT 'received',
  signature_ok          BOOLEAN NOT NULL,
  attempts              SMALLINT NOT NULL DEFAULT 0,
  processing_started_at TIMESTAMPTZ,
  processing_lease_until TIMESTAMPTZ,
  last_error_code       TEXT,
  last_error_at         TIMESTAMPTZ,
  CONSTRAINT webhook_status_chk      CHECK (process_status IN ('received','processing','processed','ignored','failed','dead_letter')),
  CONSTRAINT webhook_idempotency_unq UNIQUE (provider, event_id)
);
CREATE INDEX webhook_retry_idx ON payment_webhook_events (process_status, processing_lease_until)
  WHERE process_status IN ('received','processing','failed');

-- ───────── Newsletter ─────────
CREATE TABLE newsletter_subscriptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash         TEXT NOT NULL UNIQUE,
  email_cipher       TEXT NOT NULL, email_iv TEXT NOT NULL, key_version SMALLINT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending',
  confirm_token_hash TEXT, confirm_expires_at TIMESTAMPTZ,
  confirmed_at       TIMESTAMPTZ, unsubscribed_at TIMESTAMPTZ,
  bounce_count       SMALLINT NOT NULL DEFAULT 0,
  suppressed_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT news_status_chk CHECK (status IN ('pending','confirmed','unsubscribed','bounced','suppressed'))
);

-- ───────── Auditoria ─────────
CREATE TABLE audit_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor       TEXT NOT NULL,          -- 'system' ou subject do IdP
  actor_role  TEXT,
  action      TEXT NOT NULL,          -- 'triage.contact_read', 'triage.report_read', 'triage.export', ...
  reason      TEXT,                   -- obrigatório para leitura de relato (§6)
  entity_type TEXT NOT NULL,
  entity_id   UUID,
  ip_hash     TEXT,                   -- IP pseudonimizado, nunca o IP bruto
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_events (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_actor_idx  ON audit_events (actor, created_at DESC);
