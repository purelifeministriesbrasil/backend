// Prova discriminante de que é a RLS (e não apenas a ausência de GRANT) que impede `anon` de ler os dados.
// Usa um banco descartável criado a partir de TEST_DATABASE_URL, migrado com scripts/migrate.mjs.
// NUNCA aponte TEST_DATABASE_URL para produção.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const run = promisify(execFile);
const url = process.env.TEST_DATABASE_URL;

const TABLES = [
  "triage_submissions",
  "triage_consents",
  "contact_submissions",
  "contact_consents",
  "donation_intents",
  "payment_charges",
  "payment_webhook_events",
  "newsletter_subscriptions",
  "audit_events",
] as const;

describe.skipIf(!url)("RLS: anon com GRANT explícito continua sem ler nenhuma linha", () => {
  const dbName = `plm_rls_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let admin: postgres.Sql;
  let db: postgres.Sql;

  beforeAll(async () => {
    admin = postgres(url as string, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const u = new URL(url as string);
    u.pathname = `/${dbName}`;
    db = postgres(u.toString(), { max: 1, onnotice: () => {} });
    for (const role of ["anon", "authenticated"]) {
      const [{ exists }] = await db`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS exists`;
      if (!exists) await db.unsafe(`CREATE ROLE ${role} NOLOGIN`);
    }
    await run(process.execPath, ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: u.toString() } });

    // Uma linha em cada tabela, inserida pelo dono.
    await db.unsafe(`
      WITH t AS (
        INSERT INTO triage_submissions (reference_code, created_month, retention_until)
        VALUES ('PLM-RLS-1', date_trunc('month', now())::date, now() + interval '1 day') RETURNING id
      ) INSERT INTO triage_consents (triage_submission_id, purpose, policy_version, granted_at, origin_route)
        SELECT id, 'p', 'v', now(), '/x/' FROM t;
      WITH c AS (
        INSERT INTO contact_submissions (subject, contact_ciphertext, contact_iv, message_ciphertext, message_iv, key_version, retention_until)
        VALUES ('s', 'c', 'i', 'm', 'i', 1, now() + interval '1 day') RETURNING id
      ) INSERT INTO contact_consents (contact_submission_id, purpose, policy_version, granted_at, origin_route)
        SELECT id, 'p', 'v', now(), '/x/' FROM c;
      WITH d AS (
        INSERT INTO donation_intents (amount_cents, frequency) VALUES (1000, 'one_time') RETURNING id
      ), ch AS (
        INSERT INTO payment_charges (donation_intent_id, provider, provider_charge_id, method, amount_cents)
        SELECT id, 'asaas', 'pay_1', 'pix', 1000 FROM d RETURNING id
      ) INSERT INTO payment_webhook_events (provider, event_id, event_type, charge_id, signature_ok)
        SELECT 'asaas', 'evt_1', 'PAYMENT_RECEIVED', id, true FROM ch;
      INSERT INTO newsletter_subscriptions (email_hash, email_cipher, email_iv, key_version) VALUES ('h', 'c', 'i', 1);
      INSERT INTO audit_events (actor, action, entity_type) VALUES ('system', 'test', 'rls');
    `);

    await db.unsafe(`GRANT USAGE ON SCHEMA public TO anon`);
    for (const t of TABLES) await db.unsafe(`GRANT SELECT ON public.${t} TO anon`);
  });

  afterAll(async () => {
    if (db) {
      for (const t of TABLES) await db.unsafe(`REVOKE SELECT ON public.${t} FROM anon`).catch(() => {});
      await db.unsafe(`REVOKE USAGE ON SCHEMA public FROM anon`).catch(() => {});
      await db.end({ timeout: 5 });
    }
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end({ timeout: 5 });
  });

  it("anon não é dono, superusuário nem tem BYPASSRLS; RLS está ligada nas 9 tabelas", async () => {
    const [role] = await db`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'anon'`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const rows = await db`
      SELECT c.relname, c.relrowsecurity, pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY(${TABLES as unknown as string[]})`;
    expect(rows).toHaveLength(TABLES.length);
    for (const r of rows) {
      expect(r.relrowsecurity).toBe(true);
      expect(r.owner).not.toBe("anon");
    }
  });

  it.each(TABLES)("%s: o dono vê a linha, anon com SELECT concedido vê 0 linhas (sem erro de permissão)", async (table) => {
    const [{ n: ownerCount }] = await db.unsafe(`SELECT count(*)::int AS n FROM public.${table}`);
    expect(ownerCount).toBeGreaterThan(0);
    const anonCount = await db.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE anon`);
      const [{ n }] = await tx.unsafe(`SELECT count(*)::int AS n FROM public.${table}`);
      return n;
    });
    expect(anonCount).toBe(0);
  });

  it("controle negativo: com o mesmo GRANT, uma tabela sem RLS É lida por anon (o teste discrimina)", async () => {
    await db.unsafe(`CREATE TABLE public.rls_probe_control (id int); INSERT INTO public.rls_probe_control VALUES (1);
      GRANT SELECT ON public.rls_probe_control TO anon`);
    try {
      const n = await db.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE anon`);
        const [{ n }] = await tx.unsafe(`SELECT count(*)::int AS n FROM public.rls_probe_control`);
        return n;
      });
      expect(n).toBe(1);
    } finally {
      await db.unsafe(`DROP TABLE public.rls_probe_control`);
    }
  });
});
