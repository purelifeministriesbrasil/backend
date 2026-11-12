import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-expect-error módulo .mjs de scripts/ sem declarações de tipo
import { acceptedChecksums, canonicalChecksum, planMigrations } from "../scripts/migrate-lib.mjs";

const raw = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const LF = "CREATE TABLE a (id int);\nCREATE TABLE b (id int);\n";
const CRLF = LF.replace(/\n/g, "\r\n");

function plan(files: Record<string, string>, applied: Record<string, string> = {}) {
  return planMigrations({
    files: Object.keys(files),
    contents: new Map(Object.entries(files)),
    applied: new Map(Object.entries(applied)),
  });
}

describe("migrate: checksum independente do fim de linha", () => {
  it("o checksum canônico é igual para LF e CRLF", () => {
    expect(canonicalChecksum(CRLF)).toBe(canonicalChecksum(LF));
    expect(canonicalChecksum(LF)).toBe(raw(LF));
  });

  it("aceita registros legados gravados com hash cru em LF ou CRLF, a partir de qualquer checkout", () => {
    for (const checkout of [LF, CRLF]) {
      const accepted = acceptedChecksums(checkout);
      expect(accepted.has(raw(LF))).toBe(true);
      expect(accepted.has(raw(CRLF))).toBe(true);
    }
  });

  it("registro feito no Windows (CRLF) não é tratado como editado num checkout LF (CI)", () => {
    const r = plan({ "0001_a.sql": LF }, { "0001_a.sql": raw(CRLF) });
    expect(r.errors).toEqual([]);
    expect(r.alreadyApplied).toEqual(["0001_a.sql"]);
  });

  it("conteúdo realmente alterado continua sendo recusado", () => {
    const r = plan({ "0001_a.sql": LF + "DROP TABLE a;\n" }, { "0001_a.sql": raw(LF) });
    expect(r.errors.join(" ")).toMatch(/checksum divergente/);
  });
});

describe("migrate: plano de aplicação", () => {
  it("lista pendentes em ordem e ignora arquivos que não são .sql", () => {
    const r = plan({ "0002_b.sql": LF, "README.md": "x", "0001_a.sql": LF });
    expect(r).toEqual({ errors: [], pending: ["0001_a.sql", "0002_b.sql"], alreadyApplied: [] });
  });

  it.each(["0004-hifen.sql", "0004_Maiuscula.sql", "4_curto.sql"])("falha em nome .sql fora do padrão: %s", (name) => {
    expect(plan({ [name]: LF }).errors.join(" ")).toMatch(/Nome de migration inválido/);
  });

  it("falha quando há registro aplicado sem arquivo", () => {
    expect(plan({ "0001_a.sql": LF }, { "0001_a.sql": raw(LF), "0002_sumiu.sql": "x" }).errors.join(" ")).toMatch(
      /sem arquivo correspondente: 0002_sumiu\.sql/
    );
  });

  it("falha quando uma pendente ordena antes de uma já aplicada", () => {
    const r = plan({ "0001_a.sql": LF, "0002_nova.sql": LF, "0003_c.sql": LF }, { "0001_a.sql": raw(LF), "0003_c.sql": raw(LF) });
    expect(r.errors.join(" ")).toMatch(/0002_nova\.sql está pendente mas ordena antes de 0003_c\.sql/);
  });

  it("pendentes posteriores à última aplicada são aceitas", () => {
    const r = plan({ "0001_a.sql": LF, "0002_b.sql": LF }, { "0001_a.sql": raw(LF) });
    expect(r).toEqual({ errors: [], pending: ["0002_b.sql"], alreadyApplied: ["0001_a.sql"] });
  });
});
