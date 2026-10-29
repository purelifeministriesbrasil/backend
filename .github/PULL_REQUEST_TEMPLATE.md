## Descrição

<!-- Objetivo da mudança e partes da API afetadas. -->

## Referências

- Issue: #
- ADRs afetados: [ ] ADR-004 (criptografia) [ ] ADR-005 (idempotência) [ ] ADR-008 (Neon/Hyperdrive)

## Checklist

- [ ] `pnpm verify` passou (lint, fronteiras, typecheck e testes, incluindo os canários).
- [ ] Mudança de banco feita por migration nova em `drizzle/`, com `schema.ts` atualizado.
- [ ] Nenhum dado sensível decifrado aparece em logs ou respostas HTTP.
- [ ] Nenhum segredo, `.env`, `.dev.vars` ou dado real foi incluído.
- [ ] Se `src/schemas/` mudou, a mesma mudança foi feita no `frontend`.

## Implantação e rollback

<!-- Precisa de migration, segredo novo ou variável? Como desfazer? -->
