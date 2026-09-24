## 📝 Descrição da Alteração

Descreva sucintamente o objetivo do Pull Request e os componentes modificados na API.

## 🔗 Relação com Issues / ADRs
- Issue: #
- ADRs Impactados: [ ] ADR-002 [ ] ADR-004 [ ] ADR-005

## 📋 Checklist de Qualidade, AppSec e Governança
- [ ] `pnpm test` passou com 100% de sucesso (incluindo testes unitários e canários).
- [ ] `pnpm run verify:boundaries` passou sem qualquer violação de camadas de Clean Architecture.
- [ ] `pnpm run build` compilou sem erros de TypeScript.
- [ ] Zero dados sensíveis decifrados impressos em logs ou retornos HTTP não autorizados.
- [ ] Nenhuma credencial ou segredo hardcoded (`.env` ou arquivos de código).
