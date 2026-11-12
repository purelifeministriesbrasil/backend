// scripts/verify-package-manager.mjs — garante que a versão do pnpm é UMA só: a fixada em `packageManager`.
// Verifica: (1) package.json fixa `pnpm@X.Y.Z` exato; (2) nenhum workflow repete `version:` em pnpm/action-setup
// (a action lê `packageManager`; duas fontes divergiriam); (3) com --runtime, o `pnpm` em execução é o fixado.
// Esta cópia deve ser idêntica nos repositórios que a usam.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function pinnedPnpm(packageJsonText) {
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(JSON.parse(packageJsonText).packageManager ?? "");
  return match ? match[1] : null;
}

/** Retorna os workflows que passam `version` à action pnpm/action-setup. */
export function workflowsWithPnpmVersion(workflowsDir) {
  if (!existsSync(workflowsDir)) return [];
  return readdirSync(workflowsDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) => {
      const lines = readFileSync(join(workflowsDir, f), "utf8").split("\n");
      return lines.some((line, i) => {
        if (!line.includes("pnpm/action-setup")) return false;
        const indent = (s) => s.length - s.trimStart().length;
        // `with:` do mesmo step: procura `version:` até o próximo step (linha "- " com recuo menor ou igual).
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim().startsWith("- ") && indent(lines[j]) <= indent(line)) break;
          if (/^\s+version:/.test(lines[j])) return true;
        }
        return false;
      });
    });
}

const errors = [];
const pinned = pinnedPnpm(readFileSync("package.json", "utf8"));
if (!pinned) errors.push('package.json deve declarar "packageManager": "pnpm@X.Y.Z" (versão exata).');
for (const f of workflowsWithPnpmVersion(".github/workflows")) {
  errors.push(`.github/workflows/${f}: remova "version:" de pnpm/action-setup; a versão vem de packageManager.`);
}
if (process.argv.includes("--runtime") && pinned) {
  // execSync com comando constante: no Windows o pnpm é um shim .cmd que execFile não executa sem shell.
  const running = execSync("pnpm --version", { encoding: "utf8" }).trim();
  if (running !== pinned) errors.push(`pnpm em execução (${running}) difere do fixado em package.json (${pinned}).`);
}

if (errors.length) {
  for (const e of errors) console.error(`[verify-package-manager] ${e}`);
  process.exit(1);
}
console.log(`[verify-package-manager] pnpm ${pinned} fixado e consistente.`);
