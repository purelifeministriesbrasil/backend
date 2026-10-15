// Verifica as fronteiras da Clean Architecture (§2.1) resolvendo o caminho REAL de cada import.
// A versão anterior comparava o texto literal ("../infrastructure") e deixava passar
// imports com profundidade diferente, como "../../infrastructure/db/schema.js".
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const rootDir = process.cwd();
const srcDir = join(rootDir, "src");

function getAllTsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const fullPath = join(dir, name);
    if (statSync(fullPath).isDirectory()) return getAllTsFiles(fullPath);
    return name.endsWith(".ts") ? [fullPath] : [];
  });
}

/** Camada de um arquivo em src/: "domains", "application", "infrastructure", "presentation", "schemas" ou "root". */
function layerOf(absPath) {
  const rel = relative(srcDir, absPath).split(sep);
  return rel.length > 1 ? rel[0] : "root";
}

// Pacotes proibidos por camada (imports não relativos).
const FORBIDDEN_PACKAGES = {
  domains: [/^drizzle-orm/, /^postgres$/, /^hono/, /^resend$/, /^@neondatabase\//, /^cloudflare:/],
  application: [/^drizzle-orm/, /^postgres$/, /^hono/, /^resend$/, /^@neondatabase\//, /^cloudflare:/],
  presentation: [/^postgres$/, /^drizzle-orm/, /^@neondatabase\//],
  // schemas: apenas o Zod (clássico ou o subpacote oficial zod/mini).
  schemas: [/^(?!zod(\/mini)?$).+/],
};

// Camadas de destino proibidas para imports relativos.
const FORBIDDEN_LAYERS = {
  domains: ["application", "infrastructure", "presentation", "root"],
  application: ["infrastructure", "presentation", "root"],
  schemas: ["domains", "application", "infrastructure", "presentation", "root"],
  infrastructure: ["presentation", "root"],
};

// Subpastas de infraestrutura proibidas na apresentação (acesso a dados só via composição em src/index.ts).
const FORBIDDEN_INFRA_IN_PRESENTATION = ["db"];

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

const files = getAllTsFiles(srcDir);
console.log(`[verify-boundaries] Checking ${files.length} TypeScript files for Clean Architecture boundaries...`);

const violations = [];

for (const file of files) {
  const relPath = relative(rootDir, file).replace(/\\/g, "/");
  const content = readFileSync(file, "utf-8");
  const layer = layerOf(file);

  if (/\bprocess\.env\b/.test(content)) {
    violations.push({ file: relPath, rule: "No process.env in Worker runtime. Must receive env from fetch handler (§2.2)." });
  }

  for (const match of content.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (!specifier) continue;

    if (!specifier.startsWith(".")) {
      for (const pattern of FORBIDDEN_PACKAGES[layer] ?? []) {
        if (pattern.test(specifier)) {
          violations.push({ file: relPath, rule: `Layer '${layer}' cannot import package '${specifier}' (§2.1)` });
        }
      }
      continue;
    }

    const target = resolve(dirname(file), specifier);
    if (!target.startsWith(srcDir + sep)) {
      violations.push({ file: relPath, rule: `Import escapes src/: '${specifier}'` });
      continue;
    }
    const targetLayer = layerOf(target);

    if ((FORBIDDEN_LAYERS[layer] ?? []).includes(targetLayer)) {
      violations.push({ file: relPath, rule: `Layer '${layer}' cannot import from '${targetLayer}' ('${specifier}') (§2.1)` });
    }

    if (layer === "presentation" && targetLayer === "infrastructure") {
      const sub = relative(join(srcDir, "infrastructure"), target).split(sep)[0];
      if (FORBIDDEN_INFRA_IN_PRESENTATION.includes(sub)) {
        violations.push({ file: relPath, rule: `Presentation layer cannot import infrastructure/${sub} directly ('${specifier}') (§2.1)` });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`\n[verify-boundaries] ❌ Found ${violations.length} boundary violation(s):`);
  for (const v of violations) console.error(` - [${v.file}] ${v.rule}`);
  process.exit(1);
}

console.log(`[verify-boundaries] ✅ All ${files.length} files strictly follow Clean Architecture boundaries (§2.1 & §2.2).`);
