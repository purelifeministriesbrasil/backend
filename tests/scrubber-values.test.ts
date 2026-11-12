import { afterEach, describe, expect, it, vi } from "vitest";
import { scrubObject } from "../src/infrastructure/observability/scrubber.js";
import { log } from "../src/infrastructure/observability/logger.js";

describe("scrubber: redação pelo valor, não só pelo nome da chave", () => {
  it("mascara e-mail, CPF e telefone dentro de strings de chaves inocentes", () => {
    const out = scrubObject({
      reason: "falha ao enviar para maria.silva+news@example.com.br",
      note: "CPF 123.456.789-09 e também 12345678909",
      detail: "ligar para (11) 98765-4321 ou +55 21 3456-7890",
      list: ["contato: joao@exemplo.org"],
    });
    expect(JSON.stringify(out)).not.toMatch(/maria|joao@|123\.456|12345678909|98765|3456-7890/);
    expect(out.reason).toContain("[REDACTED_EMAIL]");
    expect(out.note).toContain("[REDACTED_CPF]");
    expect(out.detail).toContain("[REDACTED_PHONE]");
  });

  it("preserva valores operacionais: UUID, timestamps ISO, códigos e números", () => {
    const ctx = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      ts2: "2026-11-12T03:04:05.000Z",
      code: "ECONNREFUSED",
      status: 503,
      reference: "PLM-2026-0001",
      ms: 12345678,
    };
    expect(scrubObject(ctx)).toEqual(ctx);
  });

  it.each(["ip", "cpf", "address", "endereco", "subject", "assunto"])("mascara a chave sensível %s", (key) => {
    expect(scrubObject({ [key]: "valor" })).toEqual({ [key]: "[REDACTED]" });
  });
});

describe("logger: campos reservados não podem ser sobrescritos pelo contexto", () => {
  afterEach(() => vi.restoreAllMocks());

  it("level, event e ts do contexto são ignorados", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("info", "evento.real", { level: "error", event: "forjado", ts: "1970-01-01", extra: 1 });
    const entry = JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry.level).toBe("info");
    expect(entry.event).toBe("evento.real");
    expect(entry.ts).not.toBe("1970-01-01");
    expect(entry.extra).toBe(1);
    expect(Object.keys(entry).slice(0, 3)).toEqual(["level", "event", "ts"]);
  });
});
