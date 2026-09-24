# Política de Segurança e Conformidade LGPD — purelife-api

## Segurança: Relato de Vulnerabilidades

Dada a extrema confidencialidade dos dados tratados por esta API (relatos pastorais sensíveis e transações financeiras), qualquer potencial vulnerabilidade deve ser reportada com máxima urgência e absoluto sigilo.

**NÃO crie issues públicas no GitHub.**

Envie seu relatório diretamente para:
- **E-mail de Segurança**: `seguranca@purelifebrasil.org`
- **Assunto**: `[CRÍTICO - Segurança API] <Resumo>`

---

## Governança e Contribuição

Políticas Mandatórias de Proteção de Dados

1. **Proteção Rigorosa de PII e Dados de Fé/Cura**:
   - Dados de aconselhamento pastoral recebem tratamento análogo a segredo médico/pastoral sob a LGPD (Lei 13.709/2018).
   - NUNCA armazene dados de triagem em texto claro no banco de dados.
   - NUNCA imprima valores decifrados em `console.log`, `console.error` ou traces de observabilidade.
2. **Testes Canário de Vazamento (Canary Tests)**:
   - Todo novo endpoint ou fluxo que manipule dados de triagem deve conter um teste automatizado injetando a string canário `__CANARY_SENSITIVE__`, atestando que ela não surge em logs nem em colunas não criptografadas.
3. **Idempotência e Concorrência**:
   - Webhooks devem ser protegidos por concessão de lease (`webhook_events`) com tratamento de *stale leases* para impedir reprocessamento ou duplicidade financeira.
