-- drizzle/0002_supabase_hardening_and_rls.sql
-- Hardening Supabase + colunas exigidas pelos fluxos de produção.
-- Pré-requisito: 0001_initial.sql aplicada. Idempotente onde o Postgres permite.
--
-- Modelo de acesso: o Worker conecta com a role `postgres` (dona das tabelas) via
-- DATABASE_URL. As roles da Data API do Supabase (`anon`, `authenticated`) NÃO têm
-- nenhum acesso: RLS ligado sem políticas + REVOKE explícito (defesa em profundidade).
-- O frontend nunca fala com o Supabase diretamente.

-- ───────── 1. Idempotência de formulários e doações ─────────
ALTER TABLE triage_submissions  ADD COLUMN IF NOT EXISTS idempotency_key UUID;
ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS idempotency_key UUID;
ALTER TABLE donation_intents    ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS triage_idempotency_unq  ON triage_submissions (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS contact_idempotency_unq ON contact_submissions (idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS intent_idempotency_unq  ON donation_intents (idempotency_key);

-- Payload Pix "copia e cola" persistido para responder retentativas idempotentes
-- sem nova chamada ao gateway (não é dado pessoal: identifica o recebedor).
ALTER TABLE payment_charges ADD COLUMN IF NOT EXISTS pix_copy_paste TEXT;

-- ───────── 2. Contato: expurgo LGPD análogo à triagem ─────────
ALTER TABLE contact_submissions
  ALTER COLUMN contact_ciphertext DROP NOT NULL,
  ALTER COLUMN contact_iv         DROP NOT NULL,
  ALTER COLUMN message_ciphertext DROP NOT NULL,
  ALTER COLUMN message_iv         DROP NOT NULL,
  ALTER COLUMN key_version        DROP NOT NULL;

ALTER TABLE contact_submissions DROP CONSTRAINT IF EXISTS contact_purged_clean;
ALTER TABLE contact_submissions ADD CONSTRAINT contact_purged_clean CHECK (
  status <> 'purged' OR (
    reference_code IS NULL AND contact_ciphertext IS NULL AND contact_iv IS NULL
    AND message_ciphertext IS NULL AND message_iv IS NULL
  )
);
ALTER TABLE contact_submissions DROP CONSTRAINT IF EXISTS contact_cipher_present;
ALTER TABLE contact_submissions ADD CONSTRAINT contact_cipher_present CHECK (
  status = 'purged' OR (
    contact_ciphertext IS NOT NULL AND contact_iv IS NOT NULL
    AND message_ciphertext IS NOT NULL AND message_iv IS NOT NULL AND key_version IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS contact_retention_idx ON contact_submissions (retention_until) WHERE purged_at IS NULL;
CREATE INDEX IF NOT EXISTS contact_status_created_idx ON contact_submissions (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS contact_consent_unq ON contact_consents (contact_submission_id, purpose);

-- ───────── 3. Newsletter: prova de consentimento (LGPD Art. 8º §2º) ─────────
ALTER TABLE newsletter_subscriptions ADD COLUMN IF NOT EXISTS policy_version TEXT;
ALTER TABLE newsletter_subscriptions ADD COLUMN IF NOT EXISTS consented_at  TIMESTAMPTZ;
ALTER TABLE newsletter_subscriptions ADD COLUMN IF NOT EXISTS confirm_sent_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS news_confirm_token_unq ON newsletter_subscriptions (confirm_token_hash)
  WHERE confirm_token_hash IS NOT NULL;

-- ───────── 4. Índices de chave estrangeira ausentes (linter 0001_unindexed_foreign_keys) ─────────
CREATE INDEX IF NOT EXISTS webhook_charge_idx ON payment_webhook_events (charge_id);
CREATE INDEX IF NOT EXISTS charge_intent_idx  ON payment_charges (donation_intent_id);

-- ───────── 5. updated_at automático com search_path fixo (linter 0011_function_search_path_mutable) ─────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS triage_set_updated_at ON triage_submissions;
CREATE TRIGGER triage_set_updated_at BEFORE UPDATE ON triage_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS charge_set_updated_at ON payment_charges;
CREATE TRIGGER charge_set_updated_at BEFORE UPDATE ON payment_charges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ───────── 6. Row Level Security: ligado em todas as tabelas, SEM políticas ─────────
-- Sem políticas, anon/authenticated não leem nem escrevem nada via PostgREST/Realtime.
-- A role dona (postgres) ignora RLS e continua operando pelo Worker.
ALTER TABLE triage_submissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage_consents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_submissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_consents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE donation_intents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_charges          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_webhook_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events             ENABLE ROW LEVEL SECURITY;

-- ───────── 7. Revogação de privilégios das roles públicas do Supabase ─────────
-- Em Postgres puro (CI/local) as roles podem não existir: o bloco ignora com segurança.
DO $$
DECLARE
  r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END;
$$;

-- ───────── 8. Remoção de artefato legado (linter 0028/0029) ─────────
-- O antigo frontend/supabase/schema.sql criava `public.rls_auto_enable` (SECURITY DEFINER
-- exposto como RPC). Em projeto novo é no-op; em projeto legado, remove a superfície.
DROP FUNCTION IF EXISTS public.rls_auto_enable() CASCADE;
