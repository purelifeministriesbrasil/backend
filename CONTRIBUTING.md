# Guia de Contribuição — purelife-api

O repositório `purelife-api` gerencia as transações críticas, armazenamento seguro de triagens pastorais, webhooks de doações e rotinas criptográficas do **Pure Life Ministries Brasil**.

---

## Diretrizes e Checklist

Regras Estritas de Arquitetura

1. **Clean Architecture e Regra de Dependência**:
   - `domain/`: **Zero dependências externas**. Não importe Drizzle, bibliotecas de terceiros, runtime da Cloudflare ou HTTP.
   - `application/`: Depende unicamente de `domain/`. Orquestra casos de uso e define interfaces para serviços secundários.
   - `infrastructure/`: Implementa os repositórios, esquemas de banco, clientes externos (Resend, Asaas) e criptografia.
   - `presentation/`: Trata requisições HTTP, valida payloads com `purelife-contracts` e repassa aos casos de uso.

2. **Criptografia Rígida (ADR-004)**:
   - Campos de triagem pastoral (relato, telefone, e-mail) devem obrigatoriamente transitar cifrados antes de alcançar as tabelas do Neon.
   - O `triage_submission_id` deve ser fornecido como AAD em todas as operações de cifra/decifra.

3. **Verificação Automatizada de Fronteiras**:
   - O comando `pnpm run verify:boundaries` analisa todas as árvores de importação e bloqueia violações de camada.

---

## Validação Local

Validação Local Obrigatória

Antes de abrir um Pull Request:
```bash
# 1. Executar testes unitários e testes canário de vazamento de dados
pnpm run test

# 2. Executar auditoria de fronteiras de Clean Architecture
pnpm run verify:boundaries

# 3. Compilação TypeScript
pnpm run build
```

---

## Fluxo de Trabalho Git

Fluxo de Branches e Commits

- Nomeie branches descritivamente: `feat/webhook-retry-policy` ou `fix/triage-aad-binding`.
- Use mensagens Conventional Commits:
  - `feat(triage): enforce atomic unit of work on submission`
  - `test(crypto): add canary leak tests for encrypted payload`
