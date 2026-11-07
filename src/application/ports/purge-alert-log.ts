/**
 * Registro de alertas de falha do expurgo, usado só para limitar a repetição de e-mails
 * quando a mesma etapa falha dia após dia. Nunca contém dados pessoais.
 */
export interface PurgeAlertLog {
  /** Houve alerta para esta etapa desde `since`? */
  hasAlertSince(step: string, since: Date): Promise<boolean>;
  recordAlert(step: string, reference: string, at: Date): Promise<void>;
}
