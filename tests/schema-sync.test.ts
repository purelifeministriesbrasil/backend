import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error módulo .mjs de scripts/ sem declarações de tipo
import { compareSchemaDirs } from "../scripts/verify-schema-sync.mjs";

const dirs: string[] = [];
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "schemas-"));
  dirs.push(root);
  for (const [name, content] of Object.entries(files)) {
    const full = join(root, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe("verify-schema-sync", () => {
  const base = { "index.ts": "export * from './a/schema.js';\n", "a/schema.ts": "export const a = 1;\n" };

  it("considera iguais árvores idênticas, mesmo com CRLF", () => {
    const r = compareSchemaDirs(tree(base), tree({ "index.ts": "export * from './a/schema.js';\r\n", "a/schema.ts": "export const a = 1;\r\n" }));
    expect(r.inSync).toBe(true);
  });

  it("detecta arquivo com conteúdo diferente", () => {
    const r = compareSchemaDirs(tree(base), tree({ ...base, "a/schema.ts": "export const a = 2;\n" }));
    expect(r.inSync).toBe(false);
    expect(r.different).toEqual(["a/schema.ts"]);
  });

  it("detecta arquivo presente só de um lado", () => {
    const r = compareSchemaDirs(tree({ ...base, "b/schema.ts": "x\n" }), tree(base));
    expect(r.onlyInA).toEqual(["b/schema.ts"]);
    expect(r.onlyInB).toEqual([]);
    const reverse = compareSchemaDirs(tree(base), tree({ ...base, "c.ts": "x\n" }));
    expect(reverse.onlyInB).toEqual(["c.ts"]);
  });
});
