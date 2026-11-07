import { describe, expect, it } from "vitest";
// @ts-expect-error módulo .mjs de scripts/ sem declarações de tipo
import { parseSetStatusArgs, validateStatusChange, SETTABLE_STATUSES } from "../scripts/pastoral-status.mjs";

describe("pastoral-inbox set-status: argumentos", () => {
  it("aceita código, status e motivo", () => {
    const r = parseSetStatusArgs(["ABC123", "closed", "--reason", "  atendimento concluído "]);
    expect(r).toEqual({ ok: true, code: "ABC123", status: "closed", reason: "atendimento concluído" });
  });

  it("aceita --reason antes dos argumentos posicionais", () => {
    const r = parseSetStatusArgs(["--reason", "motivo válido", "ABC123", "closed"]);
    expect(r.ok).toBe(true);
  });

  it.each([
    [[]],
    [["ABC123"]],
    [["ABC123", "closed"]],
    [["ABC123", "closed", "--reason"]],
    [["ABC123", "closed", "--reason", "abc"]],
    [["ABC123", "closed", "--reason", "   "]],
    [["ABC123", "closed", "--reason", "--outro"]],
    [["ABC123", "closed", "extra", "--reason", "motivo válido"]],
  ])("rejeita argumentos ausentes ou inválidos: %j", (args) => {
    expect(parseSetStatusArgs(args).ok).toBe(false);
  });
});

describe("pastoral-inbox set-status: transições", () => {
  it("permite os status de triagem do CHECK, exceto purged", () => {
    for (const status of ["in_review", "contacted", "closed"]) {
      expect(validateStatusChange("triage", "received", status).ok).toBe(true);
    }
    expect(SETTABLE_STATUSES.triage).not.toContain("purged");
  });

  it("permite os status de contato do CHECK, exceto purged", () => {
    for (const status of ["answered", "closed"]) {
      expect(validateStatusChange("contact", "received", status).ok).toBe(true);
    }
    expect(SETTABLE_STATUSES.contact).not.toContain("purged");
  });

  it("rejeita status de triagem em contato (violaria o CHECK)", () => {
    expect(validateStatusChange("contact", "received", "in_review").ok).toBe(false);
    expect(validateStatusChange("contact", "received", "contacted").ok).toBe(false);
  });

  it("rejeita status de contato em triagem", () => {
    expect(validateStatusChange("triage", "received", "answered").ok).toBe(false);
  });

  it("nunca permite definir purged", () => {
    expect(validateStatusChange("triage", "closed", "purged").ok).toBe(false);
    expect(validateStatusChange("contact", "closed", "purged").ok).toBe(false);
  });

  it("rejeita status desconhecido, registro expurgado, status repetido e tipo desconhecido", () => {
    expect(validateStatusChange("triage", "received", "qualquer").ok).toBe(false);
    expect(validateStatusChange("triage", "purged", "closed").ok).toBe(false);
    expect(validateStatusChange("triage", "closed", "closed").ok).toBe(false);
    expect(validateStatusChange("outro", "received", "closed").ok).toBe(false);
  });
});
