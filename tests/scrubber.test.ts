import { describe, it, expect } from "vitest";
import { scrubObject } from "../src/infrastructure/observability/scrubber.js";

describe("Observability PII Scrubber (§5.1)", () => {
  it("deve mascarar campos confidenciais e PII de primeiro nível", () => {
    const payload = {
      requestId: "req-123456",
      status: "received",
      email: "pastor@igreja.org",
      fullName: "Carlos Alberto de Souza",
      phone: "+55 61 98888-7777",
      report: "Relato confidencial de aconselhamento pastoral",
      mensagem: "Mensagem enviada pelo formulário de contato",
      authorization: "Bearer secret-token-xyz",
    };

    const sanitized = scrubObject(payload);

    expect(sanitized.requestId).toBe("req-123456");
    expect(sanitized.status).toBe("received");
    expect(sanitized.email).toBe("[REDACTED]");
    expect(sanitized.fullName).toBe("[REDACTED]");
    expect(sanitized.phone).toBe("[REDACTED]");
    expect(sanitized.report).toBe("[REDACTED]");
    expect(sanitized.mensagem).toBe("[REDACTED]");
    expect(sanitized.authorization).toBe("[REDACTED]");
  });

  it("deve mascarar recursivamente campos confidenciais em objetos aninhados e arrays", () => {
    const nestedPayload = {
      meta: {
        environment: "production",
        user: {
          name: "João da Silva",
          contact: {
            telefone: "61999999999",
            email: "joao@example.com",
          },
        },
      },
      donations: [
        { id: "don_1", pixCopyPaste: "00020126360014br.gov.bcb.pix...", amountCents: 5000 },
        { id: "don_2", pixCopyPaste: "00020126360014br.gov.bcb.pix...", amountCents: 10000 },
      ],
    };

    const sanitized = scrubObject(nestedPayload);

    expect(sanitized.meta.environment).toBe("production");
    expect(sanitized.meta.user.name).toBe("[REDACTED]");
    expect(sanitized.meta.user.contact.telefone).toBe("[REDACTED]");
    expect(sanitized.meta.user.contact.email).toBe("[REDACTED]");
    expect(sanitized.donations[0].id).toBe("don_1");
    expect(sanitized.donations[0].amountCents).toBe(5000);
    expect(sanitized.donations[0].pixCopyPaste).toBe("[REDACTED]");
    expect(sanitized.donations[1].pixCopyPaste).toBe("[REDACTED]");
  });

  it("deve retornar primitivos e nulos inalterados de forma segura", () => {
    expect(scrubObject(null)).toBeNull();
    expect(scrubObject(undefined)).toBeUndefined();
    expect(scrubObject(12345)).toBe(12345);
    expect(scrubObject("string-pura")).toBe("string-pura");
    expect(scrubObject(true)).toBe(true);
  });
});
