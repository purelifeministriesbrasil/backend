// Integração do runner scripts/migrate.mjs contra PostgreSQL real. Cria um banco descartável por execução
// a partir de TEST_DATABASE_URL e o remove ao final. NUNCA aponte TEST_DATABASE_URL para produção.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const run = promisify(execFile);
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("scripts/migrate.mjs contra PostgreSQL real", () => {
  const dbName = `plm_migrate_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let admin: postgres.Sql;
  let target: postgres.Sql;
  let targetUrl: string;

  const migrate = (...args: string[]) =>
    run(process.execPath, ["scripts/migrate.mjs", ...args], { env: { ...process.env, DATABASE_URL: targetUrl } });

  beforeAll(async () => {
    admin = postgres(url as string, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const u = new URL(url as string);
    u.pathname = `/${dbName}`;
    targetUrl = u.toString();
    target = postgres(targetUrl, { max: 1, onnotice: () => {} });
    for (const role of ["anon", "authenticated"]) {
      const [{ exists }] = await target`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS exists`;
      if (!exists) await target.unsafe(`CREATE ROLE ${role} NOLOGIN`);
    }
  });

  afterAll(async () => {
    await target?.end({ timeout: 5 });
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end({ timeout: 5 });
  });

  it("--dry-run num banco vazio lista pendentes e não cria nenhum objeto", async () => {
    const { stdout } = await migrate("--dry-run");
    expect(stdout).toMatch(/~ 0001_initial\.sql \(pendente, dry-run\)/);
    const [{ reg }] = await target`SELECT to_regclass('public.schema_migrations')::text AS reg`;
    expect(reg).toBeNull();
    const [{ n }] = await target`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`;
    expect(n).toBe(0);
  });

  it("duas execuções concorrentes aplicam cada migration exatamente uma vez", async () => {
    const results = await Promise.allSettled([migrate(), migrate()]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const rows = await target`SELECT filename FROM public.schema_migrations ORDER BY filename`;
    expect(rows.map((r) => r.filename)).toEqual([
      "0001_initial.sql",
      "0002_supabase_hardening_and_rls.sql",
      "0003_newsletter_unsubscribe.sql",
    ]);
  });

  it("reexecução é idempotente e aceita checksum legado gravado a partir de checkout CRLF", async () => {
    // Simula registro feito pelo runner antigo num Windows: hash dos bytes com CRLF.
    const { createHash } = await import("node:crypto");
    const { readFileSync } = await import("node:fs");
    const lf = readFileSync("drizzle/0001_initial.sql", "utf-8").replace(/\r\n/g, "\n");
    const crlf = createHash("sha256").update(lf.replace(/\n/g, "\r\n")).digest("hex");
    await target`UPDATE public.schema_migrations SET checksum = ${crlf} WHERE filename = '0001_initial.sql'`;
    const { stdout } = await migrate();
    expect(stdout).toMatch(/= 0001_initial\.sql \(já aplicada\)/);
    expect(stdout).not.toMatch(/\+ /);
  });

  it("recusa registro aplicado sem arquivo, sem aplicar nada", async () => {
    await target`INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0099_fantasma.sql', 'x')`;
    await expect(migrate()).rejects.toMatchObject({ stderr: expect.stringMatching(/sem arquivo correspondente/) });
    await target`DELETE FROM public.schema_migrations WHERE filename = '0099_fantasma.sql'`;
  });
});
