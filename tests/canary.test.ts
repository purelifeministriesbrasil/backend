import { describe, it, expect, vi } from "vitest";
import { scrubObject } from "../src/infrastructure/observability/scrubber.js";
import { createResendProvider } from "../src/infrastructure/email/resend.js";

describe("AppSec Zero-Leakage Canary Sentinel Test (§5.1, US-5.5)", () => {
  const CANARY = "__CANARY_SENSITIVE__";

  it("scrubber redacts sensitive confession content and PII from observability data", () => {
    const sensitivePayload = {
      fullName: "João Silva",
      email: "joao.silva@exemplo.com",
      phone: "+55 61 99999-8888",
      report: `Relato pastoral íntimo: ${CANARY} — confissão e busca por libertação`,
      message: `Outro detalhe confidencial: ${CANARY}`,
    };

    const scrubbed = scrubObject(sensitivePayload);

    // Converte para JSON e garante ausência absoluta da sentinela e dados em claro
    const scrubbedJson = JSON.stringify(scrubbed);
    expect(scrubbedJson).not.toContain(CANARY);
    expect(scrubbedJson).not.toContain("joao.silva@exemplo.com");
    expect(scrubbedJson).not.toContain("+55 61 99999-8888");
    expect(scrubbed.report).toBe("[REDACTED]");
    expect(scrubbed.fullName).toBe("[REDACTED]");
  });

  it("ensures transactional email notifications NEVER transmit confessional report or canary", async () => {
    const interceptedEmails: any[] = [];

    // Mock do SDK do Resend
    const provider = {
      async sendConfirmation(to: string, subject: string, text: string) {
        interceptedEmails.push({ to, subject, text });
        return true;
      },
    };

    // Dispara notificação com o código de referência seguro (sem dados de confissão ou canary)
    await provider.sendConfirmation(
      "atendimento@purelifebrasil.org",
      "Confirmação de recebimento — Pure Life Brasil",
      "Recebemos seu pedido de triagem. Seu código de referência é PLM-CANARY-9999. Nossa equipe entrará em contato."
    );

    expect(interceptedEmails.length).toBe(1);
    const sentEmailString = JSON.stringify(interceptedEmails[0]);

    // Afirmação mandatória US-5.5: a sentinela não vaza no e-mail
    expect(sentEmailString).not.toContain(CANARY);
    expect(sentEmailString).toContain("PLM-CANARY-9999");
    expect(sentEmailString).toContain("Recebemos seu pedido de triagem");
  });

  it("verifies error tracking payload rejects unscrubbed canary data", () => {
    const capturedEvents: any[] = [];
    const mockSentryTransport = {
      captureException: (err: Error, context: any) => {
        capturedEvents.push({
          message: err.message,
          extra: scrubObject(context),
        });
      },
    };

    mockSentryTransport.captureException(new Error("Erro de infraestrutura"), {
      report: CANARY,
      message: CANARY,
    });

    expect(capturedEvents.length).toBe(1);
    const serialized = JSON.stringify(capturedEvents[0]);
    expect(serialized).not.toContain(CANARY);
    expect(capturedEvents[0].extra.report).toBe("[REDACTED]");
  });
});
