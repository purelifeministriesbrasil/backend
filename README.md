# purelife-api — Backend Cloudflare Worker & Clean Architecture

[![Cloudflare Workers](https://img.shields.io/badge/Runtime-Cloudflare%20Workers-F38020.svg)](https://workers.cloudflare.com)
[![Supabase Postgres](https://img.shields.io/badge/Database-Supabase%20Postgres-3ECF8E.svg)](https://supabase.com)
[![Drizzle ORM](https://img.shields.io/badge/ORM-Drizzle-C5F74F.svg)](https://orm.drizzle.team)
[![Cryptography](https://img.shields.io/badge/Crypto-AES--256--GCM%20%2B%20AAD-blue.svg)](./src/infrastructure/crypto)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Security Policy](https://img.shields.io/badge/Security-Policy-red.svg)](./SECURITY.md)

API de borda do **Pure Life Ministries Brasil** (`api.purelifeministriesbrasil.org`): Cloudflare Worker em TypeScript
(Hono) com **Clean Architecture**, persistência no **Supabase Postgres** via **Drizzle ORM**, PIX dinâmico via
**Asaas ou Mercado Pago**, criptografia de campo **AES-256-GCM + AAD** e expurgo LGPD automatizado.

---

## 1. Princípios

1. **Fonte única de verdade do banco**: `drizzle/*.sql`, aplicadas em ordem por `pnpm db:migrate`.
   `src/infrastructure/db/schema.ts` espelha o SQL coluna a coluna (nomes de constraints inclusive).
2. **Fail-closed**: cada funcionalidade valida sua configuração por requisição. Segredo ausente ou inválido
   (chave AES ≠ 32 bytes, chave de teste do Turnstile em produção, provedor PIX incompleto) → `503`, com log
   contendo apenas os **nomes** das chaves.
3. **Clean Architecture verificada**: `pnpm lint` roda ESLint (typescript-eslint) e
   `scripts/verify-boundaries.mjs`, que resolve o caminho real de cada import e bloqueia dependências proibidas
   entre `domains/`, `application/`, `infrastructure/`, `presentation/` e `schemas/`.
4. **Criptografia de campo (ADR-004)**: contato, relato, mensagens e e-mails são cifrados com AES-256-GCM; o AAD
   amarra `entidade:id:campo:versão`. IV aleatório de 96 bits por operação. E-mails usados para deduplicação são
   guardados como HMAC-SHA256 com pepper (`HASH_PEPPER`), nunca em claro.
5. **Idempotência ponta a ponta**: formulários e doações exigem o header `Idempotency-Key` (UUID v4); webhooks
   usam o modelo de *lease* de 60 s com no máximo 5 tentativas (ADR-005).
6. **Máquina de estados de cobrança**: uma doação `confirmed` nunca regride para `pending`, `failed` ou `expired`;
   eventos fora de ordem são ignorados e auditados em `audit_events`.
7. **LGPD**: Cron diário (`0 3 * * *`) nulifica triagens e contatos com 180 dias de retenção vencidos.

---

## 2. Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Liveness probe |
| `POST` | `/api/forms/triagem` | Triagem confidencial (Turnstile + `Idempotency-Key`) |
| `POST` | `/api/forms/contato` | Contato institucional (Turnstile + `Idempotency-Key`) |
| `POST` | `/api/forms/newsletter` | Inscrição com double opt-in (JSON ou form POST sem JS) |
| `POST` | `/api/forms/newsletter/confirm` | Confirmação a partir da página `/newsletter/confirmar/` |
| `POST` | `/api/donations/create-pix` | Cria cobrança PIX no provedor ativo (`PAYMENT_PROVIDER`) |
| `POST` | `/api/webhooks/payment` | Webhook do provedor ativo (token Asaas ou HMAC Mercado Pago) |

---

## 3. Estrutura

```
backend/
├── drizzle/                      # Migrations SQL versionadas (fonte única de verdade)
├── scripts/
│   ├── migrate.mjs               # Aplica drizzle/*.sql com checksum em schema_migrations
│   ├── pastoral-inbox.mjs        # Caixa pastoral: decifra localmente e audita cada leitura
│   └── verify-boundaries.mjs     # Linter de fronteiras da Clean Architecture
├── src/
│   ├── domains/                  # Regras puras (máquina de estados de cobrança)
│   ├── application/              # Portas e casos de uso (triagem, contato, newsletter, PIX, webhook, expurgo)
│   ├── infrastructure/           # Config, cripto, Drizzle, Resend, Asaas, Mercado Pago, Turnstile, logs
│   ├── presentation/             # Handlers HTTP e cron
│   ├── schemas/                  # Contratos Zod — cópia idêntica em frontend/src/schemas
│   └── index.ts                  # Composition root (Hono + scheduled)
└── tests/                        # Vitest: unitários, AppSec e integração com Postgres real
```

---

## 4. Comandos

```bash
pnpm install
pnpm dev                 # wrangler dev (lê .dev.vars)
pnpm lint                # ESLint + fronteiras
pnpm typecheck           # tsc --noEmit
pnpm test                # Vitest (integração com banco roda se TEST_DATABASE_URL estiver definido)
pnpm verify              # lint + typecheck + test (validação completa)
pnpm db:migrate          # aplica drizzle/*.sql em DATABASE_URL
pnpm db:migrate:dry-run  # lista migrations pendentes
pnpm deploy              # wrangler deploy
```

Testes de integração (Postgres descartável — as tabelas são truncadas):

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres pnpm db:migrate
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres pnpm test
```

---

## 5. Configuração

- Desenvolvimento: copie `.dev.vars.example` para `.dev.vars` (documenta **todas** as variáveis).
- Produção: variáveis não secretas em `[vars]` do `wrangler.toml`; segredos com `wrangler secret put`.
- Scripts Node (migrations, caixa pastoral): veja `.env.example`.

Runbook completo de implantação nas contas institucionais:
[documentação → Operações → Deploy](https://purelifeministriesbrasil.github.io/documentation/operations/deployment/).

---

## 6. Caixa pastoral (leitura de dados cifrados)

O Table Editor do Supabase exibe apenas ciphertext. Até existir um painel dedicado, a equipe autorizada usa:

```bash
OPERATOR=nome@purelifeministriesbrasil.org node scripts/pastoral-inbox.mjs list
OPERATOR=nome@purelifeministriesbrasil.org node scripts/pastoral-inbox.mjs show PLM-XXXX-XXXX --reason "primeiro contato" --include-report
OPERATOR=nome@purelifeministriesbrasil.org node scripts/pastoral-inbox.mjs set-status PLM-XXXX-XXXX contacted
```

Cada leitura grava `audit_events` (quem, quando, motivo). Execute somente em máquina confiável.

---

## 7. Governança

- [Código de Conduta](CODE_OF_CONDUCT.md) · [Contribuição](CONTRIBUTING.md) · [Segurança e LGPD](SECURITY.md) · [Licença MIT](LICENSE)
