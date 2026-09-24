# purelife-api — Backend Cloudflare Worker & Clean Architecture

[![Cloudflare Workers](https://img.shields.io/badge/Runtime-Cloudflare%20Workers-F38020.svg)](https://workers.cloudflare.com)
[![Clean Architecture](https://img.shields.io/badge/Architecture-DDD%20%2F%20Clean-success.svg)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
[![Neon Postgres](https://img.shields.io/badge/Database-Neon%20Postgres-00E599.svg)](https://neon.tech)
[![Drizzle ORM](https://img.shields.io/badge/ORM-Drizzle-C5F74F.svg)](https://orm.drizzle.team)
[![Cryptography](https://img.shields.io/badge/Crypto-AES--256--GCM%20%2B%20AAD-blue.svg)](./src/infrastructure/crypto)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Security Policy](https://img.shields.io/badge/Security-Policy-red.svg)](./SECURITY.md)

Backend oficial do ministério **Pure Life Ministries Brasil** (`purelifebrasil.org`), implementado como um Cloudflare Worker independente em TypeScript com Clean Architecture / DDD, persistência no Neon Serverless Postgres via Drizzle ORM, criptografia de campo em repouso com AES-256-GCM + AAD e rigorosa conformidade com a LGPD.

---

## Arquitetura: Arquitetura em Camadas (Clean Architecture)

A base de código segue rigorosamente o princípio da inversão de dependência. O script `pnpm run verify:boundaries` audita as fronteiras arquiteturais a cada compilação:

```
src/
├── domain/                  # Entidades, Value Objects e Regras de Negócio Puras
│   ├── entities/            # TriageSubmission, DonationTransaction, etc. (ZERO deps externas)
│   └── repositories/        # Interfaces abstratas de persistência e criptografia
├── application/             # Casos de Uso (Orquestração da Aplicação)
│   ├── use-cases/           # SubmitTriageUseCase, ProcessWebhookUseCase, PurgeExpiredTriageUseCase
│   └── services/            # Interfaces de notificação e gateways
├── infrastructure/          # Detalhes de Implementação e Adaptadores Secundários
│   ├── crypto/              # WebCrypto AES-256-GCM com AAD rígido
│   ├── db/                  # Esquemas Drizzle, migrations e conexão Neon
│   └── repositories/        # Implementação concreta dos repositórios via Neon
└── presentation/            # Adaptadores Primários (HTTP Workers API)
    ├── routes/              # Dispatchers de rotas (/api/triage, /api/webhooks, /api/cron/purge)
    ├── guards/              # Request Guards, validação Zod strict, Rate Limiters
    └── index.ts             # Entrypoint do Cloudflare Worker
```

### Segurança: Garantias de Segurança e Criptografia
1. **AES-256-GCM com AAD Rígido (ADR-004)**: Dados sensíveis de triagem pastoral (relato pessoal, telefone, e-mail) são cifrados individualmente em repouso. O ID da submissão é vinculado como *Additional Authenticated Data (AAD)* para impedir ataques de realocação criptográfica de blocos (*ciphertext swapping*).
2. **Lease Atômico para Webhooks (ADR-005)**: O processamento de notificações de pagamento Asaas opera sob um modelo de concessão atômica (`lease`) com expiração de 30 segundos, eliminando *race conditions* de requisições simultâneas.
3. **Expurgo Automatizado LGPD**: Executado periodicamente via Cloudflare Cron Triggers, purgando dados expirados e sobrescrevendo campos com sentinela criptográfica de expurgo verificado (`CHECK (triage_purged_clean)`).
4. **Testes Sentinela Canary de Zero Vazamento**: Testes automatizados injetam strings canário (`__CANARY_SENSITIVE__`) e provam matematicamente que dados em claro jamais alcançam logs, metadados ou colunas não cifradas.

---

## Instalação e Execução

Instalação e Desenvolvimento

```bash
# Instalar dependências
pnpm install

# Executar testes unitários e testes canário de segurança
pnpm test

# Verificar integridade das fronteiras da Clean Architecture
pnpm run verify:boundaries

# Executar worker localmente via Wrangler
pnpm run dev
```

---

## Governança e Contribuição

Governança e Contribuição

- [Código de Conduta](CODE_OF_CONDUCT.md)
- [Guia de Contribuição](CONTRIBUTING.md)
- [Política de Segurança e LGPD](SECURITY.md)
- [Licença MIT](LICENSE)