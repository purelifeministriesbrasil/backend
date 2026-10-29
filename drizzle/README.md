# `drizzle/` — migrations do banco

Arquivos SQL aplicados **em ordem alfabética**, uma transação por arquivo, por
[`scripts/migrate.mjs`](../scripts/migrate.mjs). São a **fonte única de verdade** do banco:
`src/infrastructure/db/schema.ts` apenas espelha este SQL, coluna a coluna.

| Arquivo | Conteúdo |
|---|---|
| `0001_initial.sql` | Tabelas: `triage_submissions`, `triage_consents`, `contact_submissions`, `contact_consents`, `donation_intents`, `payment_charges`, `payment_webhook_events`, `newsletter_subscriptions` e `audit_events` |
| `0002_supabase_hardening_and_rls.sql` | RLS ligado sem políticas + `REVOKE` das roles públicas, `set_updated_at()` com `search_path` fixo, índices de chaves estrangeiras, idempotência, expurgo de contato e consentimento da newsletter |

O nome do `0002` é histórico (o banco começou no Supabase) e foi mantido de propósito: o runner registra nome e
SHA-256 de cada arquivo em `public.schema_migrations`.

## Regras

- **Nunca edite uma migration já aplicada.** O runner recusa arquivos alterados (checksum diferente). Crie um
  arquivo novo com o próximo número: `0003_<descricao>.sql`.
- Atualize `src/infrastructure/db/schema.ts` no mesmo pull request.
- Tabelas novas: `ENABLE ROW LEVEL SECURITY` e nenhum privilégio para roles públicas.
- Prefira mudanças compatíveis (adicionar coluna anulável, depois preencher, depois restringir).

```bash
pnpm db:migrate:dry-run   # lista o que será aplicado
pnpm db:migrate           # aplica em DATABASE_URL
```
