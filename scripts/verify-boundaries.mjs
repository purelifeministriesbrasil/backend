import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

function getAllTsFiles(dir) {
  let results = [];
  const list = readdirSync(dir);
  for (const file of list) {
    const fullPath = join(dir, file);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getAllTsFiles(fullPath));
    } else if (file.endsWith(".ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

const rootDir = process.cwd();
const srcDir = join(rootDir, "src");
const files = getAllTsFiles(srcDir);

console.log(`[verify-boundaries] Checking ${files.length} TypeScript files for Clean Architecture boundaries...`);

let violations = [];

const FORBIDDEN_IN_DOMAINS = [
  "drizzle-orm",
  "@neondatabase/serverless",
  "resend",
  "cloudflare:",
  "../application",
  "../infrastructure",
  "../presentation",
];

const FORBIDDEN_IN_APPLICATION = [
  "drizzle-orm",
  "@neondatabase/serverless",
  "resend",
  "cloudflare:",
  "../infrastructure",
  "../presentation",
];

const FORBIDDEN_IN_PRESENTATION = [
  "../infrastructure/db",
  "@neondatabase/serverless",
];

for (const file of files) {
  const relPath = relative(rootDir, file).replace(/\\/g, "/");
  const content = readFileSync(file, "utf-8");

  // Rule: Prohibit process.env in Worker environment
  if (content.includes("process.env")) {
    violations.push({
      file: relPath,
      rule: "No process.env in Worker runtime. Must receive env from fetch handler (§2.2).",
    });
  }

  // Rule: Check layer import constraints
  const importLines = content
    .split("\n")
    .filter((line) => line.trim().startsWith("import ") || line.trim().startsWith("export * from"));

  for (const line of importLines) {
    if (relPath.startsWith("src/domains/")) {
      for (const forbidden of FORBIDDEN_IN_DOMAINS) {
        if (line.includes(`"${forbidden}`) || line.includes(`'${forbidden}`)) {
          violations.push({
            file: relPath,
            rule: `Domain layer cannot import '${forbidden}' (§2.1)`,
            line: line.trim(),
          });
        }
      }
    }

    if (relPath.startsWith("src/application/")) {
      for (const forbidden of FORBIDDEN_IN_APPLICATION) {
        if (line.includes(`"${forbidden}`) || line.includes(`'${forbidden}`)) {
          violations.push({
            file: relPath,
            rule: `Application layer cannot import '${forbidden}' (§2.1)`,
            line: line.trim(),
          });
        }
      }
    }

    if (relPath.startsWith("src/presentation/")) {
      for (const forbidden of FORBIDDEN_IN_PRESENTATION) {
        if (line.includes(`"${forbidden}`) || line.includes(`'${forbidden}`)) {
          violations.push({
            file: relPath,
            rule: `Presentation layer cannot import '${forbidden}' directly (§2.1)`,
            line: line.trim(),
          });
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`\n[verify-boundaries] ❌ Found ${violations.length} boundary violation(s):`);
  for (const v of violations) {
    console.error(` - [${v.file}] ${v.rule}${v.line ? ` -> "${v.line}"` : ""}`);
  }
  process.exit(1);
} else {
  console.log(`[verify-boundaries] ✅ All ${files.length} files strictly follow Clean Architecture boundaries (§2.1 & §2.2).`);
  process.exit(0);
}
