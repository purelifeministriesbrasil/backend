# Guia de Contribuição — purelife-api

Este repositório guarda a API que recebe triagens pastorais, contatos, inscrições e doações do
**Pure Life Ministries Brasil**. Os dados são sensíveis: cada mudança passa por testes e revisão.

---

## 1. Regras de arquitetura

1. **Clean Architecture** (verificada por `pnpm lint`; ver [`src/README.md`](src/README.md))
   - `domains/`: regras puras, **sem** dependências externas (nem Drizzle, nem HTTP, nem Cloudflare).
   - `application/`: casos de uso e portas; depende só de `domains/`.
   - `infrastructure/`: implementa as portas (banco, cripto, e-mail, gateways, Turnstile).
   - `presentation/`: valida a requisição com `src/schemas/` e chama os casos de uso.
2. **Criptografia (ADR-004)**
   - Contato, relato, mensagens e e-mails são cifrados **antes** de chegar ao banco.
   - O AAD é `entidade:id:campo:versão`; nunca reutilize um ciphertext em outro registro ou campo.
3. **Banco**
   - Mudanças de schema só por migration nova em `drizzle/` (ver [`drizzle/README.md`](drizzle/README.md)).
4. **Contratos**
   - `src/schemas/` é idêntica à do `frontend`; altere os dois juntos.

---

## 2. Validação local

```bash
pnpm verify   # ESLint + fronteiras + typecheck + testes
```

Fluxos novos com dados sensíveis precisam de teste no `tests/canary.test.ts`.

---

## 3. Fluxo de trabalho Git

- Branch a partir do `main`: `feat/…`, `fix/…`, `docs/…`, `ci/…`.
- Mensagens no padrão *Conventional Commits*:
  - `feat(triage): grava o consentimento na mesma transação`
  - `test(crypto): cobre a troca de versão da chave`
- Nunca inclua segredos, `.env`, `.dev.vars` ou dados reais em commits, testes ou pull requests.
