-- 0004: retenção da newsletter (R-RET-1) e índices para a limpeza de auditoria e webhooks (R-RET-3 e R-RET-4).
-- Aditiva e reversível: nenhuma linha existente é alterada; só se relaxam NOT NULL do e-mail cifrado e se
-- adiciona purged_at. Aplicar ANTES de publicar a versão do Worker que usa purged_at.
--
-- Regra: inscrição cancelada há 30 dias perde o e-mail cifrado e os tokens e fica só com email_hash
-- (lista de supressão irreversível). Ver documentation: Inventário de Retenção.

ALTER TABLE newsletter_subscriptions ALTER COLUMN email_cipher DROP NOT NULL;
ALTER TABLE newsletter_subscriptions ALTER COLUMN email_iv DROP NOT NULL;
ALTER TABLE newsletter_subscriptions ALTER COLUMN key_version DROP NOT NULL;
ALTER TABLE newsletter_subscriptions ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ;

ALTER TABLE newsletter_subscriptions DROP CONSTRAINT IF EXISTS news_purged_clean;
ALTER TABLE newsletter_subscriptions ADD CONSTRAINT news_purged_clean CHECK (
  purged_at IS NULL OR (
    status = 'unsubscribed'
    AND email_cipher IS NULL AND email_iv IS NULL AND key_version IS NULL
    AND confirm_token_hash IS NULL AND unsubscribe_token_hash IS NULL
  )
);

ALTER TABLE newsletter_subscriptions DROP CONSTRAINT IF EXISTS news_cipher_present;
ALTER TABLE newsletter_subscriptions ADD CONSTRAINT news_cipher_present CHECK (
  purged_at IS NOT NULL OR (email_cipher IS NOT NULL AND email_iv IS NOT NULL AND key_version IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS news_unsubscribed_retention_idx ON newsletter_subscriptions (unsubscribed_at)
  WHERE status = 'unsubscribed' AND purged_at IS NULL;
CREATE INDEX IF NOT EXISTS news_pending_retention_idx ON newsletter_subscriptions (created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_events (created_at);
CREATE INDEX IF NOT EXISTS webhook_received_idx ON payment_webhook_events (received_at)
  WHERE process_status IN ('processed', 'ignored', 'dead_letter');
