# purelife-api

API do Pure Life Ministries Brasil: Cloudflare Worker (Hono, TypeScript) com PostgreSQL no Neon via Hyperdrive.

[![CI](https://github.com/purelifeministriesbrasil/backend/actions/workflows/ci.yml/badge.svg)](https://github.com/purelifeministriesbrasil/backend/actions/workflows/ci.yml)
[![CodeQL](https://github.com/purelifeministriesbrasil/backend/actions/workflows/codeql.yml/badge.svg)](https://github.com/purelifeministriesbrasil/backend/actions/workflows/codeql.yml)
[![Licença: MIT](https://img.shields.io/badge/Licen%C3%A7a-MIT-blue.svg)](LICENSE)

> Parte do ecossistema Pure Life Ministries Brasil:
> [backend](https://github.com/purelifeministriesbrasil/backend) ·
> [frontend](https://github.com/purelifeministriesbrasil/frontend) ·
> [documentação](https://purelifeministriesbrasil.github.io/documentation/)

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Início rápido](#2-início-rápido)
3. [Comandos](#3-comandos)
4. [Estrutura do repositório](#4-estrutura-do-repositório)
5. [Configuração](#5-configuração)
6. [Qualidade e CI](#6-qualidade-e-ci)
7. [Publicação e reversão](#7-publicação-e-reversão)
8. [Manutenção](#8-manutenção)
9. [Governança](#9-governança)

## 1. Visão geral

Worker em TypeScript (Hono) organizado em camadas (Clean Architecture). Recebe triagem, contato, newsletter e
doações PIX do site e grava no Neon Postgres por meio do Cloudflare Hyperdrive, com Drizzle ORM.

| Princípio | Como é garantido |
|---|---|
| Sigilo | Contato, relato e e-mails cifrados com AES-256-GCM; o AAD amarra `entidade:id:campo:versão`. E-mails de deduplicação viram HMAC-SHA256 com *pepper*. |
| Fail-closed | Configuração validada por requisição; segredo ausente ou inválido → `503`, com log só dos nomes das variáveis. Sem `PAYMENT_PROVIDER`, `/api/donations/create-pix` e `/api/webhooks/payment` respondem `503`. |
| Idempotência | `Idempotency-Key` (UUID v4) em formulários e doações; *lease* de 60 s (até 5 tentativas) nos webhooks (ADR-005). |
| Doação nunca regride | Máquina de estados: uma cobrança `confirmed` não volta a `pending`, `failed` ou `expired`. |
| Limitação de taxa | Bindings `RL_*` por IP e endpoint (janela de 60 s); `RATE_LIMIT_MODE` = `off`, `log` (só registra `rate_limit.would_block`) ou `enforce` (`429`). Webhooks não são limitados. |
| LGPD | Cron diário (`0 3 * * *`) anula triagens e contatos com retenção de 180 dias vencida. |
| Isolamento no banco | RLS e `REVOKE` para os papéis públicos; provado em `tests/rls.db.test.ts` e na CI. |
| Arquitetura verificada | [`scripts/verify-boundaries.mjs`](scripts/verify-boundaries.mjs) bloqueia imports proibidos entre camadas. |

### Endpoints

| Método | Rota | Descrição | Limite (`RL_*`) |
|---|---|---|---|
| `GET` | `/health` | Disponibilidade (não toca no banco) | — |
| `POST` | `/api/forms/triagem` | Triagem confidencial (Turnstile + `Idempotency-Key`) | `RL_TRIAGE` (10/min) |
| `POST` | `/api/forms/contato` | Contato institucional (Turnstile + `Idempotency-Key`) | `RL_CONTACT` (10/min) |
| `POST` | `/api/forms/newsletter` | Inscrição com confirmação dupla | `RL_NEWSLETTER` (5/min) |
| `POST` | `/api/forms/newsletter/confirm` | Confirmação da inscrição | `RL_NEWSLETTER` |
| `POST` | `/api/forms/newsletter/unsubscribe` | Cancelamento da inscrição | `RL_NEWSLETTER` |
| `POST` | `/api/donations/create-pix` | Cobrança PIX no provedor ativo (`503` sem `PAYMENT_PROVIDER`) | `RL_DONATION` (5/min) |
| `POST` | `/api/webhooks/payment` | Webhook do provedor (`503` sem `PAYMENT_PROVIDER`) | — |

Contratos: [Contratos de Dados](https://purelifeministriesbrasil.github.io/documentation/schemas/triage-schema/).

## 2. Início rápido

Pré-requisitos:

| Ferramenta | Versão | Fonte |
|---|---|---|
| Node.js | 22 | [`.nvmrc`](.nvmrc), CI |
| pnpm | 12.18.0 | `packageManager` em [`package.json`](package.json) |

1. Instale as dependências.

   ```bash
   pnpm install
   ```

2. Crie as variáveis do Worker local (o exemplo lista todas).

   ```bash
   cp .dev.vars.example .dev.vars
   ```

3. Crie o `.env` dos scripts Node (migrations, caixa pastoral, testes com banco).

   ```bash
   cp .env.example .env
   ```

4. Rode o Worker em `http://localhost:8787`.

   ```bash
   pnpm dev
   ```

5. Valide antes de abrir um pull request.

   ```bash
   pnpm verify
   ```

## 3. Comandos

| Comando | O que faz |
|---|---|
| `pnpm dev` | `wrangler dev` (lê `.dev.vars`) |
| `pnpm deploy` | `wrangler deploy` |
| `pnpm build` | `tsc --noEmit` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | `vitest run`; os testes `*.db.test.ts` rodam só com `TEST_DATABASE_URL` |
| `pnpm lint` | ESLint em `src` + `verify-boundaries` |
| `pnpm verify:boundaries` | Só a verificação de fronteiras entre camadas |
| `pnpm verify` | `lint` + `typecheck` + `test` |
| `pnpm verify:pnpm` | Confere a versão do pnpm contra `packageManager` |
| `pnpm db:migrate` | Aplica as migrations de `drizzle/` em `DATABASE_URL` |
| `pnpm db:migrate:dry-run` | Lista as pendentes, somente leitura (sem criar tabela nem tomar lock) |

## 4. Estrutura do repositório

```text
backend/
├── .github/      # CI, CodeQL, Deploy API, schema sync, Dependabot, CODEOWNERS, modelos de issue/PR
├── drizzle/      # Migrations SQL, fonte única de verdade do banco
├── scripts/      # Runner de migrations, caixa pastoral, verificações (camadas, pnpm, schemas)
├── src/          # Worker por camada: domains, application, infrastructure, presentation, schemas
├── tests/        # Vitest: unidade, AppSec e integração com Postgres (*.db.test.ts)
└── wrangler.toml # Worker de produção: rota, vars, Hyperdrive, cron, rate limiting
```

Cada pasta principal tem seu `README.md`: [drizzle](drizzle/README.md), [scripts](scripts/README.md),
[src](src/README.md), [tests](tests/README.md).

## 5. Configuração

| Nome | Tipo | Onde é definido |
|---|---|---|
| `PUBLIC_SITE_ORIGIN`, `ENVIRONMENT`, `PIX_EXPIRATION_MINUTES`, `TRIAGE_KEY_CURRENT_VERSION`, `EMAIL_FROM`, `STAFF_NOTIFICATION_EMAIL`, `RATE_LIMIT_MODE` | var | `wrangler.toml` → `[vars]` |
| `PAYMENT_PROVIDER` (`asaas` \| `mercadopago`), `ASAAS_API_BASE_URL` | var | `wrangler.toml` (hoje ausentes: pagamentos em `503`) |
| `DATABASE_URL`, `TRIAGE_KEY_V1`, `HASH_PEPPER`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY` | secret | `wrangler secret put` |
| `ASAAS_API_KEY`, `ASAAS_WEBHOOK_SECRET`, `ASAAS_DONATION_CUSTOMER_ID` ou `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_PAYER_FALLBACK_EMAIL` | secret | `wrangler secret put`, só com o provedor ligado |
| `HYPERDRIVE`, `RL_CONTACT`, `RL_TRIAGE`, `RL_NEWSLETTER`, `RL_DONATION` | binding | `wrangler.toml` |
| Todos os acima, para desenvolvimento | local | `.dev.vars` (fora do Git) |
| `DATABASE_URL` (conexão direta do Neon), `TRIAGE_KEY_Vn`, `OPERATOR`, `TEST_DATABASE_URL` | local | `.env` dos scripts Node (fora do Git) |
| `CLOUDFLARE_API_TOKEN` | secret do repositório | GitHub, usado pelo workflow Deploy API |

Nenhum segredo é versionado. Com o binding `HYPERDRIVE` presente, `DATABASE_URL` vira reserva.

### Banco de dados e migrations

- `drizzle/` é a fonte única do esquema; [`scripts/migrate.mjs`](scripts/migrate.mjs) aplica em ordem.
- Checksum calculado sobre o conteúdo normalizado para LF (registros antigos em CRLF continuam válidos).
- Um advisory lock de sessão serializa execuções concorrentes; `--dry-run` apenas lê.
- Testes de integração exigem um Postgres descartável em `TEST_DATABASE_URL` (as tabelas são truncadas). Nunca aponte para produção.

## 6. Qualidade e CI

| Arquivo | Gatilho | Check | O que garante |
|---|---|---|---|
| [`ci.yml`](.github/workflows/ci.yml) | push e PR em `main` | `Lint, Boundaries, Typecheck, Tests and DB integration` | Versão do pnpm, ESLint + fronteiras, typecheck, migrations em Postgres, `anon` sem privilégios, testes (incl. `*.db.test.ts`), bundle `wrangler deploy --dry-run` |
| [`schema-sync.yml`](.github/workflows/schema-sync.yml) | push, PR, semanal (seg 12:00 UTC), manual | `src/schemas idêntico ao do frontend` | `src/schemas` igual ao do frontend; em PR só avisa |
| [`codeql.yml`](.github/workflows/codeql.yml) | PR, push em `main` e semanal (segunda) | `Análise de segurança (CodeQL)` | Análise estática de segurança (`security-and-quality`) |
| [`deploy.yml`](.github/workflows/deploy.yml) | manual (`workflow_dispatch`) | `Verificação completa` + `Publicar Worker (<destino>)` | Verificação completa e publicação (seção 7) |
| [`dependabot.yml`](.github/dependabot.yml) | semanal | — | PRs agrupados de GitHub Actions e npm |

Estilo de arquivos: [`.editorconfig`](.editorconfig).

## 7. Publicação e reversão

Caminho padrão: workflow **Deploy API** ([`deploy.yml`](.github/workflows/deploy.yml)), disparo manual no
ambiente `production`. Ele roda a verificação completa antes de publicar e exige o secret `CLOUDFLARE_API_TOKEN`.

| Input `target` | Destino |
|---|---|
| `workersdev` | `https://purelife-api.purelifeministriesbrasil1986.workers.dev` (provisório) |
| `domain` | `api.purelifeministriesbrasil.org` (após o domínio estar ativo) |

Alternativa manual, a partir de um checkout limpo de `main`:

```bash
pnpm verify
```

```bash
pnpm deploy
```

Migrations: primeiro crie um branch de backup no Neon, depois aplique com a conexão direta.

```bash
pnpm db:migrate:dry-run
```

```bash
pnpm db:migrate
```

Reversão do Worker: liste as versões e volte para a anterior.

```bash
pnpm exec wrangler deployments list
```

```bash
pnpm exec wrangler rollback <version-id>
```

O rollback do Worker não desfaz migrations; para o banco, restaure a partir do branch de backup do Neon.
Runbook: [Implantação](https://purelifeministriesbrasil.github.io/documentation/operations/deployment/).

## 8. Manutenção

| Tarefa | Referência |
|---|---|
| Rotina do mantenedor | [Guia do Mantenedor](https://purelifeministriesbrasil.github.io/documentation/operations/maintainer-guide/) |
| Publicar | [Implantação](https://purelifeministriesbrasil.github.io/documentation/operations/deployment/) |
| Backup e restauração do Neon | [Backup e recuperação](https://purelifeministriesbrasil.github.io/documentation/operations/backup-recovery/) |
| Rotacionar chaves e segredos | [Rotação de chaves](https://purelifeministriesbrasil.github.io/documentation/operations/key-rotation/) |
| Responder a incidentes | [Resposta a incidentes](https://purelifeministriesbrasil.github.io/documentation/operations/incident-response/) |
| Proteção de branches | [Branch protection](https://purelifeministriesbrasil.github.io/documentation/operations/branch-protection/) |
| Ativar limitação de taxa | Trocar `RATE_LIMIT_MODE` de `log` para `enforce` em `wrangler.toml` após avaliar `rate_limit.would_block` |

### Caixa pastoral

O editor do Neon mostra apenas texto cifrado. A equipe autorizada lê as triagens pela CLI, que decifra
localmente e registra cada leitura em `audit_events`. Use só em computador confiável; o `.env` precisa de
`DATABASE_URL`, `OPERATOR` e das chaves `TRIAGE_KEY_Vn`.

```bash
node --env-file=.env scripts/pastoral-inbox.mjs list
```

```bash
node --env-file=.env scripts/pastoral-inbox.mjs show PLM-XXXX-XXXX --reason "primeiro contato" --include-report
```

```bash
node --env-file=.env scripts/pastoral-inbox.mjs set-status PLM-XXXX-XXXX contacted --reason "retorno por telefone"
```

Status permitidos em `set-status`: triagem `received`, `in_review`, `contacted`, `closed`; contato `received`,
`answered`, `closed`. `purged` é exclusivo do expurgo.

## 9. Governança

| Documento | Conteúdo |
|---|---|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Fluxo de contribuição |
| [SECURITY.md](SECURITY.md) | Política de segurança e LGPD |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Código de conduta |
| [LICENSE](LICENSE) | MIT |
| [CODEOWNERS](.github/CODEOWNERS) | Revisores obrigatórios |
| Dependabot | Atualizações semanais agrupadas de GitHub Actions e npm, revisadas como qualquer PR |
