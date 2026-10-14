/**
 * Notificações transacionais. Implementações NUNCA lançam: devolvem `false` em falha
 * para que a persistência já concluída não seja desfeita por indisponibilidade do provedor.
 * Conteúdo enviado jamais inclui relato, mensagem ou dados de contato (§5.1, US-5.5).
 */
export interface Notifier {
  notifyStaff(subject: string, text: string): Promise<boolean>;
  sendToRecipient(to: string, subject: string, text: string): Promise<boolean>;
}
