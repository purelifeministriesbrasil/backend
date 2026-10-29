# Política de Segurança e LGPD — purelife-api

## 1. Como relatar uma vulnerabilidade

Esta API trata relatos pastorais sensíveis e pagamentos. Qualquer suspeita de falha deve ser relatada com
urgência e sigilo. **Não abra uma issue pública.** Envie para:

- **E-mail:** `purelifeministriesbrasil1986@gmail.com`
- **Assunto:** `[CRÍTICO - Segurança API] <resumo>`

Inclua o endpoint afetado, os passos para reproduzir (sem usar dados reais) e o impacto. Pedimos até 30 dias para
corrigir antes de qualquer divulgação.

---

## 2. Regras obrigatórias de proteção de dados

1. **Dados pastorais são sigilosos** (LGPD, Lei 13.709/2018, Art. 11)
   - Nunca grave triagem, contato ou e-mail em texto claro: cifre com AES-256-GCM antes do banco.
   - Nunca escreva valores decifrados em `console.*`, logs ou respostas de erro; o `scrubber` é a última
     barreira, não a primeira.
2. **Testes canário**
   - Todo fluxo novo com dados sensíveis injeta a sentinela `__CANARY_SENSITIVE__` e prova que ela não aparece
     em logs nem em colunas não cifradas (`tests/canary.test.ts`).
3. **Pagamentos**
   - Webhooks autenticados (token do Asaas em tempo constante ou HMAC do Mercado Pago) e processados com *lease*
     em `payment_webhook_events`, para impedir duplicidade.
4. **Segredos**
   - Só em `wrangler secret` e no cofre da organização. Nunca em código, testes, logs ou pull requests.
5. **Retenção**
   - Triagens e contatos são anulados após 180 dias pelo cron diário.
