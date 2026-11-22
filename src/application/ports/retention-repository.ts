/**
 * Porta das regras de retenção que não são "expurgo de formulário": newsletter, auditoria e webhooks.
 * Cada método processa no máximo `limit` registros e devolve quantos foram afetados; a próxima execução
 * continua de onde parou, porque a seleção é sempre "vencido e ainda não tratado".
 */
export interface RetentionRepository {
  /** Apaga inscrições `pending` cuja última solicitação de confirmação é anterior a `olderThan`. */
  deleteStalePendingNewsletter(olderThan: Date, limit: number): Promise<number>;
  /**
   * Para inscrições `unsubscribed` com cancelamento anterior a `olderThan`: apaga o e-mail cifrado e os tokens,
   * mantendo só `email_hash` (impede novo envio sem guardar o endereço). Marca `purged_at`.
   */
  anonymizeUnsubscribedNewsletter(olderThan: Date, purgedAt: Date, limit: number): Promise<number>;
  /** Apaga eventos de auditoria anteriores a `olderThan`. */
  deleteAuditEvents(olderThan: Date, limit: number): Promise<number>;
  /** Apaga webhooks de pagamento concluídos (`processed`, `ignored`, `dead_letter`) recebidos antes de `olderThan`. */
  deleteFinishedWebhookEvents(olderThan: Date, limit: number): Promise<number>;
}
