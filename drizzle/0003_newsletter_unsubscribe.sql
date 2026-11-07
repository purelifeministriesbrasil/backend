-- 0003: descadastro da newsletter (R1, parte 1).
-- Token de descadastro de uso único: só o SHA-256 é persistido; expira em unsubscribe_expires_at.
-- Aditiva e reversível: nenhuma coluna ou linha existente é alterada ou removida.
ALTER TABLE newsletter_subscriptions ADD COLUMN IF NOT EXISTS unsubscribe_token_hash TEXT;
ALTER TABLE newsletter_subscriptions ADD COLUMN IF NOT EXISTS unsubscribe_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS news_unsubscribe_token_unq ON newsletter_subscriptions (unsubscribe_token_hash)
  WHERE unsubscribe_token_hash IS NOT NULL;
