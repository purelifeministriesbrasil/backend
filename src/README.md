# `src/` — código do Worker

Organizado em **Clean Architecture**: as dependências apontam sempre para dentro. A regra é verificada
automaticamente por [`scripts/verify-boundaries.mjs`](../scripts/verify-boundaries.mjs) (`pnpm lint`).

```
presentation ──► application ──► domains
      │               ▲
      └──► infrastructure (implementa as portas de application)
schemas: usados por presentation; só dependem do zod/mini
```

| Camada | Pasta | Conteúdo | Pode importar |
|---|---|---|---|
| Domínio | `domains/` | `donations/state-machine.ts`: transições válidas de uma cobrança | Nada externo |
| Aplicação | `application/` | `usecases/` (triagem, contato, newsletter, PIX, webhook, expurgos), `ports/` (interfaces) e `reference-code.ts` | `domains/` |
| Infraestrutura | `infrastructure/` | Implementações das portas (ver abaixo) | `application/`, `domains/` e bibliotecas |
| Apresentação | `presentation/` | Handlers HTTP (`forms/`, `donations/`, `webhooks/`), `health.ts`, `http.ts` (respostas padronizadas) e `cron/purge.ts` | Todas as camadas e `schemas/` |
| Contratos | `schemas/` | Esquemas `zod/mini`, idênticos ao frontend | Só `zod/mini` |
| Raiz | `index.ts` | Composition root: monta as dependências, as rotas Hono e o `scheduled` | Tudo |

## `infrastructure/`

| Pasta | Responsabilidade |
|---|---|
| `config/` | Leitura e validação fail-closed das variáveis de ambiente |
| `crypto/` | `aes-gcm.ts` (cifra de campo com chaveiro por versão) e `hashing.ts` (HMAC com *pepper*) |
| `db/` | `db.ts` (conexão via Hyperdrive), `schema.ts` (espelho do SQL de `drizzle/`), repositórios, unidade de trabalho e idempotência |
| `email/` | Envio pela Resend |
| `payments/` | Gateways Asaas e Mercado Pago, `factory.ts` (escolhe pelo `PAYMENT_PROVIDER`) e `brt.ts` (datas no fuso de Brasília) |
| `security/` | Turnstile e limites da requisição (tamanho, tipo de conteúdo) |
| `observability/` | Logger estruturado e `scrubber.ts`, que remove dados pessoais dos logs |
| `http/` | `fetch` com tempo limite para serviços externos |
