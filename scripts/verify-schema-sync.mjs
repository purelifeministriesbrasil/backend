// scripts/verify-schema-sync.mjs — detecta deriva entre src/schemas deste repositório e do repositório irmão.
// Os contratos Zod do frontend e do backend precisam ser idênticos (hoje a sincronização é manual).
// Uso: node scripts/verify-schema-sync.mjs <caminho-do-outro-repo> [--warn-only]
//   --warn-only: em vez de falhar, emite um aviso (usado em PRs, onde a outra metade da mudança ainda não está na main).
// Esta cópia deve ser idêntica nos dois repositórios.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full).split("\\").join("/"));
    }
  };
  walk(root);
  return out;
}

const read = (root, file) => readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");

/** Compara duas árvores de schemas; ignora diferenças de fim de linha. */
export function compareSchemaDirs(dirA, dirB) {
  const a = new Set(listFiles(dirA));
  const b = new Set(listFiles(dirB));
  const onlyInA = [...a].filter((f) => !b.has(f));
  const onlyInB = [...b].filter((f) => !a.has(f));
  const different = [...a].filter((f) => b.has(f) && read(dirA, f) !== read(dirB, f));
  return { onlyInA, onlyInB, different, inSync: !onlyInA.length && !onlyInB.length && !different.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const warnOnly = args.includes("--warn-only");
  const other = args.find((a) => !a.startsWith("--"));
  if (!other) {
    console.error("Uso: node scripts/verify-schema-sync.mjs <caminho-do-outro-repo> [--warn-only]");
    process.exit(2);
  }
  const result = compareSchemaDirs(resolve("src/schemas"), resolve(other, "src/schemas"));
  if (result.inSync) {
    console.log("[verify-schema-sync] src/schemas idêntico nos dois repositórios.");
  } else {
    const lines = [
      ...result.different.map((f) => `diferente: ${f}`),
      ...result.onlyInA.map((f) => `só neste repositório: ${f}`),
      ...result.onlyInB.map((f) => `só no outro repositório: ${f}`),
    ];
    const message = `Deriva em src/schemas entre frontend e backend: ${lines.join("; ")}`;
    if (warnOnly) {
      console.log(`::warning title=Deriva de schemas::${message}. Aplique a mesma mudança no outro repositório antes do merge.`);
    } else {
      console.error(`[verify-schema-sync] ${message}`);
      process.exit(1);
    }
  }
}
