# `src/schemas/` — contratos de dados

Esquemas `zod/mini` dos formulários e da API. Esta pasta é **idêntica byte a byte** nos repositórios
[`frontend`](https://github.com/purelifeministriesbrasil/frontend/tree/main/src/schemas) e
[`backend`](https://github.com/purelifeministriesbrasil/backend/tree/main/src/schemas): o navegador valida com as
mesmas regras e mensagens que a API aplica.

| Pasta | Contrato |
|---|---|
| `common/` | E-mail, telefone, token do Turnstile, consentimento |
| `triage/` | Triagem confidencial (`POST /api/forms/triagem`) |
| `contact/` | Contato institucional (`POST /api/forms/contato`) |
| `newsletter/` | Inscrição e confirmação da newsletter |
| `donations/` | Cobrança PIX e eventos de webhook |

Cada pasta tem `schema.ts` (regras) e `types.ts` (tipos inferidos); `index.ts` reexporta tudo.

## Como alterar

1. Faça a mesma mudança nos dois repositórios, no mesmo dia, com a **mesma versão do Zod** nos dois
   `package.json`.
2. Confira que as pastas continuam iguais: `diff -r frontend/src/schemas backend/src/schemas`.
3. Use sempre `z.strictObject` (campos desconhecidos são rejeitados) e só importe `zod/mini`.
4. Atualize a página correspondente em
   [Contratos de Dados](https://purelifeministriesbrasil.github.io/documentation/schemas/triage-schema/).
