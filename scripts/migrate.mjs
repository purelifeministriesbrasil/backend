// scripts/migrate.mjs — aplica drizzle/*.sql em ordem lexicográfica, uma transação por arquivo.
// Uso: DATABASE_URL="postgresql://..." node scripts/migrate.mjs [--dry-run]
// Fonte única de verdade do schema: backend/drizzle/. Registra cada arquivo em
// public.schema_migrations (nome + SHA-256) e recusa migrations já aplicadas que foram editadas.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle");
const dryRun = process.argv.includes("--dry-run");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[migrate] DATABASE_URL não definido.");
  process.exit(1);
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  .sort();

const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });

try {
  await sql`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY`;

  const applied = new Map(
    (await sql`SELECT filename, checksum FROM public.schema_migrations`).map((r) => [r.filename, r.checksum])
  );

  for (const file of files) {
    const content = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    const checksum = createHash("sha256").update(content).digest("hex");
    const previous = applied.get(file);

    if (previous) {
      if (previous !== checksum) {
        throw new Error(`Migration ${file} já aplicada foi alterada (checksum divergente). Crie uma nova migration.`);
      }
      console.log(`[migrate] = ${file} (já aplicada)`);
      continue;
    }

    if (dryRun) {
      console.log(`[migrate] ~ ${file} (pendente, dry-run)`);
      continue;
    }

    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO public.schema_migrations (filename, checksum) VALUES (${file}, ${checksum})`;
    });
    console.log(`[migrate] + ${file} aplicada`);
  }

  console.log("[migrate] Concluído.");
} catch (err) {
  console.error(`[migrate] Falha: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
