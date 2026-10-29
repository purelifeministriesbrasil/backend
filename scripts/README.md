# `scripts/` — ferramentas de operação

Scripts Node executados fora do Worker. Os que acessam o banco leem as variáveis de `backend/.env`
(modelo em `.env.example`), passadas com `node --env-file=.env`.

| Script | Uso | O que faz |
|---|---|---|
| `migrate.mjs` | `pnpm db:migrate` / `pnpm db:migrate:dry-run` | Aplica `drizzle/*.sql` em ordem, registra nome e SHA-256 em `schema_migrations` e recusa migrations aplicadas que foram editadas |
| `pastoral-inbox.mjs` | `node --env-file=.env scripts/pastoral-inbox.mjs list` | Caixa pastoral: lista, mostra (`show <código> --reason "…"`) e muda o status (`set-status <código> in_review\|contacted\|closed`) de triagens e contatos, decifrando localmente e registrando cada leitura em `audit_events` |
| `verify-boundaries.mjs` | `pnpm lint` | Resolve cada import de `src/` e falha se uma camada depender de outra proibida |

## Cuidados

- `migrate.mjs` deve usar a conexão **direta** do Neon (sem `-pooler`).
- `pastoral-inbox.mjs` exibe dados sensíveis: use só em computador confiável, informe sempre um motivo real e
  não copie o conteúdo para outros sistemas.
