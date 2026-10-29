# `tests/` — suíte Vitest

```bash
pnpm test      # tudo (os testes com banco real são pulados sem TEST_DATABASE_URL)
pnpm verify    # lint + fronteiras + typecheck + testes
```

| Arquivo | Cobre |
|---|---|
| `triage.test.ts` | `POST /api/forms/triagem` ponta a ponta, com unidade de trabalho e cifra reais |
| `contact.test.ts` | `POST /api/forms/contato` |
| `newsletter.test.ts` | Inscrição, confirmação dupla e formulário sem JavaScript |
| `create-pix.test.ts` | `POST /api/donations/create-pix` com portas simuladas |
| `webhook.test.ts` | Webhooks de pagamento e *lease* de idempotência (ADR-005) |
| `gateways.test.ts` | Clientes Asaas e Mercado Pago |
| `state-machine.test.ts` | Transições da cobrança (uma doação confirmada nunca regride) |
| `uow.test.ts` | Atomicidade da unidade de trabalho da triagem |
| `crypto.test.ts` | AES-256-GCM com AAD e chaveiro por versão |
| `canary.test.ts` | Sentinela `__CANARY_SENSITIVE__`: dado sensível nunca aparece em logs nem em colunas em claro |
| `scrubber.test.ts` | Remoção de dados pessoais dos logs |
| `request-guards.test.ts` | Limites de tamanho e tipo de conteúdo |
| `router.test.ts` | Rotas Hono, CORS e headers de segurança |
| `config.test.ts` | Configuração fail-closed (`503` sem segredos válidos) |
| `deferred-notification.test.ts` | Aviso à equipe enviado depois da resposta ao usuário |
| `purge.test.ts` | Expurgo LGPD de triagens e contatos |
| `integration.db.test.ts` | Integração com Postgres real (só com `TEST_DATABASE_URL`) |
| `helpers.ts` | Fábricas de requisição, ambiente e portas falsas |

## Testes com banco real

Use um Postgres **descartável**: o teste executa `TRUNCATE` nas tabelas. Nunca aponte para produção.

```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres pnpm db:migrate
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres pnpm test
```

Fluxo novo que manipula dados sensíveis precisa de um caso no `canary.test.ts`.
