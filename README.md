# purelife-api — Backend Cloudflare Worker & Clean Architecture

[![Cloudflare Workers](https://img.shields.io/badge/Runtime-Cloudflare%20Workers-F38020.svg)](https://workers.cloudflare.com)
[![Clean Architecture](https://img.shields.io/badge/Architecture-DDD%20%2F%20Clean-success.svg)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
[![Supabase Postgres](https://img.shields.io/badge/Database-Supabase%20Postgres-3ECF8E.svg)](https://supabase.com)
[![Drizzle ORM](https://img.shields.io/badge/ORM-Drizzle-C5F74F.svg)](https://orm.drizzle.team)
[![Cryptography](https://img.shields.io/badge/Crypto-AES--256--GCM%20%2B%20AAD-blue.svg)](./src/infrastructure/crypto)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Security Policy](https://img.shields.io/badge/Security-Policy-red.svg)](./SECURITY.md)

Backend de borda do ministério **Pure Life Ministries Brasil** (`purelifeministriesbrasil.org`), implementado como um **Cloudflare Worker** serverless em TypeScript com **Clean Architecture (DDD)**, persistência no **Supabase Postgres** via **Drizzle ORM**, integração financeira com gateway Asaas (PIX Dinâmico), criptografia de dados sensíveis em repouso com **AES-256-GCM + AAD** e expurgo automatizado em conformidade com a LGPD (Art. 11 — Dados Sensíveis).

---

## 1. Princípios Arquiteturais e Fronteiras

Em estrita observância à diretriz canônica do ecossistema:
> **"Front com Front, Back com Back e Docs com Docs."**

1. **Clean Architecture / Inversão de Dependência**: O núcleo de regras de negócio (`domain/` e `application/`) é 100% puro e isolado de frameworks, bibliotecas HTTP e drivers de banco.
2. **Auditoria Automatizada de Fronteiras**: O linter arquitetural (`node ./scripts/verify-boundaries.mjs`, executado via `pnpm lint`) verifica todos os 39 arquivos TypeScript para impedir vazamento de dependências entre camadas.
3. **Criptografia de Campo em Repouso (ADR-004)**: Dados sensíveis pastorais (nome, e-mail, telefone, relato pessoal) são criptografados individualmente com WebCrypto AES-256-GCM. O identificador UUID da submissão é amarrado como *Additional Authenticated Data (AAD)* para neutralizar ataques de realocação criptográfica.
4. **Idempotência e Modelo de Lease para Webhooks (ADR-005)**: O processamento de confirmações de pagamento Asaas opera sob concessão atômica (`lease`) com TTL de 30 segundos, prevenindo concorrência, duplicação e *race conditions*.
5. **Expurgo Diário Automatizado LGPD**: Cloudflare Cron Trigger programado diariamente (`0 3 * * *`) expurga dados confidenciais após o período regulamentar de retenção e aplica sentinelas criptográficas de expurgo verificado.

---

## 2. Estrutura de Diretórios

```
backend/
├── scripts/
│   └── verify-boundaries.mjs     # Linter automatizado de fronteiras de Clean Architecture
├── src/
│   ├── domain/                   # Entidades, Value Objects e Contratos Puros (ZERO dependências externas)
│   │   ├── entities/             # Triage, Donation, WebhookEvent
│   │   └── repositories/         # Interfaces abstratas de portas secundárias
│   ├── application/              # Casos de Uso (Orquestração e Regras da Aplicação)
│   │   ├── ports/                # Interfaces de gateways, criptografia e Unit of Work
│   │   └── usecases/             # submit-triage, create-pix-charge, purge-triage, process-webhook
│   ├── infrastructure/           # Adaptadores Secundários Concretos
│   │   ├── crypto/               # WebCrypto AES-256-GCM com rotação de chaves
│   │   ├── db/                   # Drizzle ORM, cliente de banco Supabase, schemas e Unit of Work
│   │   ├── payments/             # Gateways Asaas e Mercado Pago
│   │   └── security/             # Validador Cloudflare Turnstile e Request Guards
│   ├── presentation/             # Adaptadores Primários (HTTP Workers API e Cron Handlers)
│   │   ├── cron/                 # Handler agendado de expurgo LGPD
│   │   ├── donations/            # Geração de cobrança PIX dinâmico
│   │   ├── forms/                # Handlers de triagem, contato e newsletter
│   │   ├── webhooks/             # Webhooks idempotentes de pagamento
│   │   └── health.ts             # Endpoint de liveness probe (/health)
│   └── index.ts                  # Entrypoint principal do Cloudflare Worker
├── tests/                        # 36 testes automatizados com Vitest
│   ├── canary.test.ts            # Testes sentinela de zero vazamento de dados em logs
│   ├── crypto.test.ts            # Testes de criptografia AES-256-GCM e adulteração de AAD
│   ├── purge.test.ts             # Testes de expurgo LGPD e idempotência
│   ├── request-guards.test.ts    # Testes de proteção contra DDoS, CORS e payload excessivo
│   ├── scrubber.test.ts          # Testes de sanitização e mascaramento de logs
│   ├── state-machine.test.ts     # Testes da máquina de estados de transações
│   ├── uow.test.ts               # Testes de consistência transacional do Unit of Work
│   └── webhook.test.ts           # Testes de validação de assinatura e leases de webhook
├── wrangler.toml                 # Configuração do Cloudflare Worker e Cron Triggers
├── tsconfig.json                 # Configuração estrita do TypeScript
└── package.json
```

---

## 3. Instalação e Execução

### Pré-requisitos
- Node.js 22 LTS
- pnpm 10+
- Wrangler CLI 3+

### Comandos Disponíveis

```bash
# Instalar dependências
pnpm install

# Executar suíte completa de testes automatizados (36 testes)
pnpm test

# Verificar fronteiras arquiteturais (Clean Architecture Linter)
pnpm run lint

# Compilar código TypeScript
pnpm run build

# Iniciar servidor de desenvolvimento local com Wrangler
pnpm run dev
```

---

## 4. Variáveis de Ambiente e Segredos

No ambiente de produção ou arquivo `.dev.vars` para execução local:

```ini
PUBLIC_SITE_ORIGIN=https://purelifeministriesbrasil.org
ENVIRONMENT=production
DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres
TRIAGE_KEY_V1=base64-encoded-32-byte-aes-key
ASAAS_API_KEY=your-asaas-api-key
ASAAS_WEBHOOK_SECRET=your-asaas-webhook-secret
TURNSTILE_SECRET_KEY=your-cloudflare-turnstile-secret
RESEND_API_KEY=your-resend-api-key
```

---

## 5. Governança e Contribuição

- [Código de Conduta](CODE_OF_CONDUCT.md)
- [Guia de Contribuição](CONTRIBUTING.md)
- [Política de Segurança e LGPD](SECURITY.md)
- [Licença MIT](LICENSE)