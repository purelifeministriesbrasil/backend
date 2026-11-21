/**
 * Notificações transacionais. Implementações NUNCA lançam: devolvem `false` em falha
 * para que a persistência já concluída não seja desfeita por indisponibilidade do provedor.
 * Conteúdo enviado jamais inclui relato, mensagem ou dados de contato (§5.1, US-5.5).
 */
export interface Notifier {
  /** `html` é opcional: sem ele o adaptador gera a versão com a identidade visual a partir de `text`. */
  notifyStaff(subject: string, text: string, html?: string): Promise<boolean>;
  sendToRecipient(to: string, subject: string, text: string, html?: string): Promise<boolean>;
}

/**
 * Agenda trabalho para depois da resposta HTTP (no Worker: `executionCtx.waitUntil`).
 * Resolve assim que o trabalho foi agendado; fora do runtime Workers pode aguardá-lo inline.
 */
export type DeferTask = (task: Promise<unknown>) => Promise<void>;
