import type { Notifier } from "../../application/ports/notifier.js";
import type { EmailConfig } from "../config/env.js";
import { fetchWithTimeout } from "../http/fetch.js";
import { log } from "../observability/logger.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Adaptador Resend via API REST (sem SDK): timeout explícito e nenhuma exceção vaza.
 * Falha de envio é registrada (sem destinatário nem conteúdo) e devolve `false`.
 */
export function createResendNotifier(config: EmailConfig, timeoutMs = 5_000): Notifier {
  async function send(to: string, subject: string, text: string, kind: string): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: config.from, to: [to], subject, text }),
        timeoutMs,
      });
      if (!res.ok) {
        log("warn", "email.send_failed", { kind, status: res.status });
        return false;
      }
      return true;
    } catch (err) {
      log("warn", "email.send_failed", { kind, reason: err instanceof Error ? err.name : "unknown" });
      return false;
    }
  }

  return {
    notifyStaff: (subject, text) => send(config.staffRecipient, subject, text, "staff"),
    sendToRecipient: (to, subject, text) => send(to, subject, text, "recipient"),
  };
}
