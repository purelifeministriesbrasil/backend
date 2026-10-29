<h1 align="center">purelife-api</h1>

<p align="center">
  API do <strong>Pure Life Ministries Brasil</strong> — <code>api.purelifeministriesbrasil.org</code>
</p>

<p align="center">
  <a href="https://workers.cloudflare.com"><img src="https://img.shields.io/badge/Runtime-Cloudflare%20Workers-F38020.svg" alt="Cloudflare Workers" /></a>
  <a href="https://hono.dev"><img src="https://img.shields.io/badge/HTTP-Hono-E36002.svg" alt="Hono" /></a>
  <a href="https://neon.tech"><img src="https://img.shields.io/badge/Banco-Neon%20%2B%20Hyperdrive-00E599.svg" alt="Neon + Hyperdrive" /></a>
  <a href="https://orm.drizzle.team"><img src="https://img.shields.io/badge/ORM-Drizzle-C5F74F.svg" alt="Drizzle ORM" /></a>
  <a href="./src/infrastructure/crypto"><img src="https://img.shields.io/badge/Cripto-AES--256--GCM%20%2B%20AAD-blue.svg" alt="AES-256-GCM" /></a>
  <a href="./SECURITY.md"><img src="https://img.shields.io/badge/Seguran%C3%A7a-pol%C3%ADtica-red.svg" alt="Política de segurança" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/Licen%C3%A7a-MIT-blue.svg" alt="Licença MIT" /></a>
</p>

---

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Endpoints](#2-endpoints)
3. [Início rápido](#3-início-rápido)
4. [Estrutura do repositório](#4-estrutura-do-repositório)
5. [Configuração](#5-configuração)
6. [Banco de dados](#6-banco-de-dados)
7. [Caixa pastoral](#7-caixa-pastoral)
8. [Publicação](#8-publicação)
9. [Governança](#9-governança)

---

## 1. Visão geral

Cloudflare Worker em TypeScript (**Hono**) organizado em **Clean Architecture**. Recebe a triagem, o contato,
a newsletter e as doações PIX do site; grava no **Neon Postgres** (São Paulo) por meio do **Cloudflare
Hyperdrive**, com **Drizzle ORM**.

| Princípio | Como é garantido |
|---|---|
| **Sigilo** | Contato, relato e e-mails cifrados com AES-256-GCM; o AAD amarra `entidade:id:campo:versão`. E-mails de deduplicação viram HMAC-SHA256 com *pepper*. |
| **Fail-closed** | Configuração validada por requisição; segredo ausente ou inválido → `503`, com log só dos **nomes** das variáveis. |
| **Idempotência** | `Idempotency-Key` (UUID v4) em formulários e doações; *lease* de 60 s (até 5 tentativas) nos webhooks (ADR-005). |
| **Doação nunca regride** | Máquina de estados: uma cobrança `confirmed` não volta a `pending`, `failed` ou `expired`. |
| **LGPD** | Cron diário (`0 3 * * *`) anula triagens e contatos com 180 dias de retenção vencidos. |
| **Arquitetura verificada** | `scripts/verify-boundaries.mjs` bloqueia imports proibidos entre camadas. |

---

## 2. Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Verificação de disponibilidade (não toca no banco) |
| `POST` | `/api/forms/triagem` | Triagem confidencial (Turnstile + `Idempotency-Key`) |
| `POST` | `/api/forms/contato` | Contato institucional (Turnstile + `Idempotency-Key`) |
| `POST` | `/api/forms/newsletter` | Inscrição com confirmação dupla (JSON ou formulário sem JavaScript) |
| `POST` | `/api/forms/newsletter/confirm` | Confirmação a partir de `/newsletter/confirmar/` |
| `POST` | `/api/donations/create-pix` | Cria cobrança PIX no provedor ativo (`PAYMENT_PROVIDER`) |
| `POST` | `/api/webhooks/payment` | Webhook do provedor (token do Asaas ou HMAC do Mercado Pago) |

Contratos detalhados: [Contratos de Dados](https://purelifeministriesbrasil.github.io/documentation/schemas/triage-schema/).

---

## 3. Início rápido

Pré-requisitos: **Node 22** e **pnpm**.

```bash
pnpm install
cp .dev.vars.example .dev.vars   # variáveis do Worker local (documenta todas)
cp .env.example .env             # scripts Node: migrations e caixa pastoral
pnpm dev                         # http://localhost:8787
```

| Comando | O que faz |
|---|---|
| `pnpm dev` | `wrangler dev` com `.dev.vars` |
| `pnpm verify` | Validação completa: lint + fronteiras + typecheck + testes |
| `pnpm lint` | ESLint + `verify-boundaries` |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest (os testes com banco real rodam só com `TEST_DATABASE_URL`) |
| `pnpm db:migrate` / `pnpm db:migrate:dry-run` | Aplica / lista as migrations de `drizzle/` em `DATABASE_URL` |
| `pnpm deploy` | `wrangler deploy` |

---

## 4. Estrutura do repositório

```
backend/
├── drizzle/              # Migrations SQL (fonte única de verdade do banco)     → drizzle/README.md
├── scripts/              # Migrations, caixa pastoral e verificação de camadas   → scripts/README.md
├── src/                  # Código do Worker, por camada                          → src/README.md
│   ├── domains/          # Regras puras (máquina de estados da cobrança)
│   ├── application/      # Casos de uso e portas (interfaces)
│   ├── infrastructure/   # Banco, cripto, e-mail, gateways, Turnstile, logs
│   ├── presentation/     # Handlers HTTP e cron
│   ├── schemas/          # Contratos zod/mini — idênticos ao frontend            → src/schemas/README.md
│   └── index.ts          # Composition root (rotas Hono + scheduled)
├── tests/                # Vitest: unidade, AppSec e integração com Postgres    → tests/README.md
├── wrangler.toml         # Worker de produção (rota, vars, Hyperdrive, cron)
└── .github/              # CI, modelos de issue e de pull request
```

---

## 5. Configuração

| Onde | O quê |
|---|---|
| `wrangler.toml` → `[vars]` | Valores não secretos de produção (origem do site, provedor PIX, remetente de e-mail) |
| `wrangler secret put` | `DATABASE_URL`, `TRIAGE_KEY_V1`, `HASH_PEPPER`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY` e, se o PIX dinâmico for ligado, `ASAAS_*` ou `MERCADOPAGO_*` |
| `[[hyperdrive]]` | Binding `HYPERDRIVE` (conexão com o Neon); `DATABASE_URL` fica como reserva |
| `.dev.vars` | Desenvolvimento local (fora do Git) |
| `.env` | Scripts Node: conexão **direta** do Neon e `OPERATOR` (fora do Git) |

Nenhum segredo é versionado. Rotação: [Rotação de Chaves](https://purelifeministriesbrasil.github.io/documentation/operations/key-rotation/).

---

## 6. Banco de dados

```bash
pnpm db:migrate:dry-run   # mostra o que falta aplicar
pnpm db:migrate           # aplica em DATABASE_URL (use a conexão direta do Neon)
```

Testes de integração em um Postgres **descartável** (as tabelas são truncadas):

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres pnpm db:migrate
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres pnpm test
```

---

## 7. Caixa pastoral

O editor de tabelas do Neon mostra apenas texto cifrado. A equipe autorizada lê as triagens pela CLI, que
decifra **localmente** e registra cada leitura em `audit_events` (quem, quando e por quê):

```bash
node --env-file=.env scripts/pastoral-inbox.mjs list
node --env-file=.env scripts/pastoral-inbox.mjs show PLM-XXXX-XXXX --reason "primeiro contato" --include-report
node --env-file=.env scripts/pastoral-inbox.mjs set-status PLM-XXXX-XXXX contacted
```

Execute somente em computador confiável; o `.env` precisa de `DATABASE_URL`, `OPERATOR` e das chaves
`TRIAGE_KEY_Vn`.

---

## 8. Publicação

```bash
pnpm verify && pnpm deploy
```

Antes da virada do domínio, a API roda em `purelife-api.purelifeministriesbrasil1986.workers.dev`, publicada com
um `wrangler.workersdev.toml` local (fora do Git). Runbook completo:
[Implantação](https://purelifeministriesbrasil.github.io/documentation/operations/deployment/).

---

## 9. Governança

[Contribuição](CONTRIBUTING.md) · [Segurança e LGPD](SECURITY.md) · [Código de Conduta](CODE_OF_CONDUCT.md) ·
[Licença MIT](LICENSE) · [Documentação técnica](https://purelifeministriesbrasil.github.io/documentation/)
