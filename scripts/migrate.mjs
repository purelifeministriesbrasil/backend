// scripts/migrate.mjs — aplica drizzle/*.sql em ordem lexicográfica, uma transação por arquivo.
// Uso: DATABASE_URL="postgresql://..." node scripts/migrate.mjs [--dry-run]
// Fonte única de verdade do schema: backend/drizzle/. Registra cada arquivo em
// public.schema_migrations (nome + SHA-256 do conteúdo normalizado para LF) e recusa:
// migrations já aplicadas que foram editadas, nomes fora do padrão, registros sem arquivo e
// pendentes que ordenam antes de uma já aplicada. Execuções concorrentes são serializadas por
// advisory lock. --dry-run apenas lê: não cria tabela, não toma lock, não altera nada.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { MIGRATION_LOCK_KEY, canonicalChecksum, planMigrations } from "./migrate-lib.mjs";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
const dryRun = process.argv.includes("--dry-run");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[migrate] DATABASE_URL não definido.");
  process.exit(1);
}

const files = readdirSync(MIGRATIONS_DIR);
const contents = new Map(
  files.filter((name) => name.toLowerCase().endsWith(".sql")).map((name) => [name, readFileSync(join(MIGRATIONS_DIR, name), "utf-8")])
);

// max: 1 garante que lock, leitura e aplicação usem a mesma sessão.
const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
let locked = false;

async function readApplied() {
  const [{ exists }] = await sql`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`;
  if (!exists) return new Map();
  return new Map((await sql`SELECT filename, checksum FROM public.schema_migrations`).map((r) => [r.filename, r.checksum]));
}

try {
  if (!dryRun) {
    await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    locked = true;
    await sql`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename   TEXT PRIMARY KEY,
        checksum   TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    await sql`ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY`;
  }

  const plan = planMigrations({ files, contents, applied: await readApplied() });
  if (plan.errors.length > 0) throw new Error(plan.errors.join(" "));

  for (const file of plan.alreadyApplied) console.log(`[migrate] = ${file} (já aplicada)`);

  for (const file of plan.pending) {
    if (dryRun) {
      console.log(`[migrate] ~ ${file} (pendente, dry-run)`);
      continue;
    }
    const content = contents.get(file);
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO public.schema_migrations (filename, checksum) VALUES (${file}, ${canonicalChecksum(content)})`;
    });
    console.log(`[migrate] + ${file} aplicada`);
  }

  console.log("[migrate] Concluído.");
} catch (err) {
  console.error(`[migrate] Falha: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  if (locked) await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`.catch(() => {});
  await sql.end({ timeout: 5 });
}
