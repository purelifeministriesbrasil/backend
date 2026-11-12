// Integração do scripts/pastoral-inbox.mjs: nenhuma listagem é exibida se a auditoria falhar.
// Banco descartável criado a partir de TEST_DATABASE_URL. NUNCA aponte para produção.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const run = promisify(execFile);
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("pastoral-inbox list: auditoria antes da exibição", () => {
  const dbName = `plm_inbox_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let admin: postgres.Sql;
  let db: postgres.Sql;
  let dbUrl: string;

  const inbox = (...args: string[]) =>
    run(process.execPath, ["scripts/pastoral-inbox.mjs", ...args], {
      env: { ...process.env, DATABASE_URL: dbUrl, OPERATOR: "teste@example.org" },
    });

  beforeAll(async () => {
    admin = postgres(url as string, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const u = new URL(url as string);
    u.pathname = `/${dbName}`;
    dbUrl = u.toString();
    db = postgres(dbUrl, { max: 1, onnotice: () => {} });
    for (const role of ["anon", "authenticated"]) {
      const [{ exists }] = await db`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS exists`;
      if (!exists) await db.unsafe(`CREATE ROLE ${role} NOLOGIN`);
    }
    await run(process.execPath, ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: dbUrl } });
    await db`INSERT INTO triage_submissions (reference_code, program_interest, created_month, retention_until)
             VALUES ('PLM-INBOX-0001', 'online', date_trunc('month', now())::date, now() + interval '1 day')`;
  });

  afterAll(async () => {
    await db?.end({ timeout: 5 });
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end({ timeout: 5 });
  });

  it("com auditoria funcionando, lista e registra inbox.list", async () => {
    const { stdout } = await inbox("list");
    expect(stdout).toContain("PLM-INBOX-0001");
    const [{ n }] = await db`SELECT count(*)::int AS n FROM audit_events WHERE action = 'inbox.list'`;
    expect(n).toBe(1);
  });

  it("se a auditoria falhar, sai com erro e não exibe nenhum registro", async () => {
    await db.unsafe(`
      CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit indisponível'; END $$;
      CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_audit();`);
    try {
      const err = await inbox("list").then(
        () => null,
        (e: { stdout: string; code: number }) => e
      );
      expect(err).not.toBeNull();
      expect(err?.code).not.toBe(0);
      expect(err?.stdout ?? "").not.toContain("PLM-INBOX-0001");
    } finally {
      await db.unsafe(`DROP TRIGGER fail_audit ON audit_events; DROP FUNCTION fail_audit();`);
    }
  });
});
