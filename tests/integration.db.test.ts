// Integração com PostgreSQL real (migrations de drizzle/ já aplicadas via `pnpm db:migrate`).
// Executa somente com TEST_DATABASE_URL definido; NUNCA aponte para produção (TRUNCATE nas tabelas).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { createDbClient, type DbHandle } from "../src/infrastructure/db/db.js";
import { createAesGcmProvider } from "../src/infrastructure/crypto/aes-gcm.js";
import { createKeyedHasher, sha256Hex } from "../src/infrastructure/crypto/hashing.js";
import { createTriageUnitOfWork } from "../src/infrastructure/db/unit-of-work.js";
import { createDrizzleContactRepository } from "../src/infrastructure/db/contact-repository.js";
import { createDrizzleNewsletterRepository } from "../src/infrastructure/db/newsletter-repository.js";
import { createDrizzleChargeRepository, createDrizzleDonationRepository } from "../src/infrastructure/db/donation-repository.js";
import { createIdempotencyRepository } from "../src/infrastructure/db/idempotency.js";
import { createDrizzlePurgeRepository } from "../src/infrastructure/db/purge-repository.js";
import { handleScheduledPurge } from "../src/presentation/cron/purge.js";
import { createDrizzlePurgeAlertLog } from "../src/infrastructure/db/purge-alert-log.js";
import { createDrizzleRetentionRepository } from "../src/infrastructure/db/retention-repository.js";
import { randomKeyB64 } from "./helpers.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Repositórios Drizzle contra PostgreSQL real", () => {
  let handle: DbHandle;
  const enc = createAesGcmProvider({ 1: randomKeyB64() }, 1);
  let hashEmail: (v: string) => Promise<string>;

  beforeAll(async () => {
    handle = createDbClient(url as string);
    hashEmail = await createKeyedHasher(randomKeyB64());
  });
  afterAll(async () => handle.close());
  beforeEach(async () => {
    await handle.db.execute(sql`TRUNCATE payment_webhook_events, payment_charges, donation_intents, triage_consents,
      triage_submissions, contact_consents, contact_submissions, newsletter_subscriptions, audit_events CASCADE`);
  });

  const consent = { purpose: "teste", policyVersion: "2026-09-19", originRoute: "/x/", grantedAt: new Date() };

  it("triage UoW persists ciphertexts + consent atomically and is idempotent", async () => {
    const uow = createTriageUnitOfWork(handle.db, enc);
    const key = crypto.randomUUID();
    const input = {
      referenceCode: "PLM-TEST-0001",
      idempotencyKey: key,
      triage: {
        programInterest: "online" as const,
        contactChannel: "email" as const,
        contactPlaintext: '{"fullName":"Fulano"}',
        reportPlaintext: "relato",
        retentionUntil: new Date(Date.now() + 86_400_000),
      },
      consent,
    };
    const first = await uow.createSubmissionWithConsent(input);
    const replay = await uow.createSubmissionWithConsent({ ...input, referenceCode: "PLM-TEST-0002" });

    expect(first.created).toBe(true);
    expect(replay).toEqual({ submissionId: first.submissionId, referenceCode: "PLM-TEST-0001", created: false });

    const rows = await handle.db.execute(sql`SELECT contact_ciphertext, report_ciphertext, key_version,
      (SELECT count(*) FROM triage_consents) AS consents FROM triage_submissions`);
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(String(row.contact_ciphertext)).not.toContain("Fulano");
    expect(Number(row.consents)).toBe(1);

    const decrypted = await enc.decrypt(
      { ciphertext: String(row.contact_ciphertext), iv: (await handle.db.execute(sql`SELECT contact_iv FROM triage_submissions`))[0].contact_iv as string, keyVersion: 1, algorithm: "AES-256-GCM" },
      { entityType: "triage_submission", entityId: first.submissionId, field: "contact" }
    );
    expect(decrypted).toBe('{"fullName":"Fulano"}');
  });

  it("contact repository is idempotent and stores only ciphertext", async () => {
    const repo = createDrizzleContactRepository(handle.db, enc);
    const key = crypto.randomUUID();
    const input = {
      referenceCode: "CTT-TEST-0001",
      idempotencyKey: key,
      contact: { subject: "Geral", contactPlaintext: '{"email":"a@b.c"}', messagePlaintext: "olá mundo!!", retentionUntil: new Date(Date.now() - 1000) },
      consent,
    };
    expect((await repo.createWithConsent(input)).created).toBe(true);
    expect((await repo.createWithConsent(input)).created).toBe(false);
    const dump = JSON.stringify(await handle.db.execute(sql`SELECT * FROM contact_submissions`));
    expect(dump).not.toContain("a@b.c");
    expect(dump).not.toContain("olá mundo");
  });

  it("newsletter double opt-in: pending → cooldown → confirm once", async () => {
    const repo = createDrizzleNewsletterRepository(handle.db, enc, hashEmail);
    const now = new Date();
    const base = { email: "leitor@example.com", policyVersion: "2026-09-19", consentedAt: now, confirmExpiresAt: new Date(now.getTime() + 3_600_000), unsubscribeTokenHash: await sha256Hex("unsub-0"), unsubscribeExpiresAt: new Date(now.getTime() + 86_400_000), resendCooldownSeconds: 900, now };
    const hash1 = await sha256Hex("token-1");

    expect(await repo.upsertPending({ ...base, confirmTokenHash: hash1 })).toEqual({ kind: "confirmation_required" });
    expect(await repo.upsertPending({ ...base, confirmTokenHash: await sha256Hex("token-2") })).toEqual({ kind: "no_action" });
    expect(await repo.confirm(hash1, now)).toBe(true);
    expect(await repo.confirm(hash1, now)).toBe(false);
    expect(await repo.upsertPending({ ...base, confirmTokenHash: await sha256Hex("token-3"), now: new Date(now.getTime() + 3_600_000) })).toEqual({ kind: "no_action" });

    const dump = JSON.stringify(await handle.db.execute(sql`SELECT * FROM newsletter_subscriptions`));
    expect(dump).not.toContain("leitor@example.com");
  });

  it("newsletter unsubscribe: single-use, expiring, and re-subscription needs a new double opt-in", async () => {
    const repo = createDrizzleNewsletterRepository(handle.db, enc, hashEmail);
    const now = new Date();
    const unsub1 = await sha256Hex("unsub-1");
    const base = {
      email: "saida@example.com",
      policyVersion: "2026-09-19",
      consentedAt: now,
      confirmTokenHash: await sha256Hex("conf-1"),
      confirmExpiresAt: new Date(now.getTime() + 3_600_000),
      unsubscribeTokenHash: unsub1,
      unsubscribeExpiresAt: new Date(now.getTime() + 86_400_000),
      resendCooldownSeconds: 0,
      now,
    };
    await repo.upsertPending(base);
    await repo.confirm(base.confirmTokenHash, now);

    expect(await repo.unsubscribe(await sha256Hex("desconhecido"), now)).toBe(false);
    expect(await repo.unsubscribe(unsub1, new Date(now.getTime() + 2 * 86_400_000))).toBe(false); // expirado
    expect(await repo.unsubscribe(unsub1, now)).toBe(true);
    expect(await repo.unsubscribe(unsub1, now)).toBe(false); // uso único

    const [row] = (await handle.db.execute(
      sql`SELECT status, unsubscribed_at, unsubscribe_token_hash, confirm_token_hash FROM newsletter_subscriptions`
    )) as unknown as { status: string; unsubscribed_at: Date | null; unsubscribe_token_hash: string | null; confirm_token_hash: string | null }[];
    expect(row.status).toBe("unsubscribed");
    expect(row.unsubscribed_at).not.toBeNull();
    expect(row.unsubscribe_token_hash).toBeNull();
    expect(row.confirm_token_hash).toBeNull();

    // Nova inscrição exige novo consentimento e confirmação (volta a pending, não a confirmed).
    const again = await repo.upsertPending({ ...base, confirmTokenHash: await sha256Hex("conf-2"), unsubscribeTokenHash: await sha256Hex("unsub-2") });
    expect(again).toEqual({ kind: "confirmation_required" });
    const [after] = (await handle.db.execute(sql`SELECT status, unsubscribed_at FROM newsletter_subscriptions`)) as unknown as { status: string; unsubscribed_at: Date | null }[];
    expect(after.status).toBe("pending");
    expect(after.unsubscribed_at).toBeNull();
  });

  it("donation intent + charge are idempotent and the charge transition is conditional", async () => {
    const donations = createDrizzleDonationRepository(handle.db, enc, hashEmail);
    const charges = createDrizzleChargeRepository(handle.db);
    const key = crypto.randomUUID();

    const intent = await donations.findOrCreateIntent({ idempotencyKey: key, amountCents: 5000, frequency: "one_time", donorEmail: "d@example.com" });
    const charge = await donations.saveFirstCharge({ intentId: intent.intentId, provider: "asaas", providerChargeId: "pay_1", amountCents: 5000, pixCopyPaste: "000201", expiresAt: new Date() });
    const again = await donations.saveFirstCharge({ intentId: intent.intentId, provider: "asaas", providerChargeId: "pay_2", amountCents: 5000, pixCopyPaste: "000202", expiresAt: new Date() });
    expect(again.chargeId).toBe(charge.chargeId);

    const replay = await donations.findOrCreateIntent({ idempotencyKey: key, amountCents: 5000, frequency: "one_time" });
    expect(replay.created).toBe(false);
    expect(replay.existingCharge?.pixCopyPaste).toBe("000201");

    expect(await charges.transitionStatus(charge.chargeId, "pending", "confirmed", new Date())).toBe(true);
    // Segunda transição a partir de um estado desatualizado não sobrescreve (sem regressão).
    expect(await charges.transitionStatus(charge.chargeId, "pending", "failed", new Date())).toBe(false);
    const found = await charges.findByProviderChargeId("asaas", "pay_1");
    expect(found?.status).toBe("confirmed");
    await charges.recordAudit("charge.amount_mismatch", charge.chargeId, { expectedCents: 5000 });
  });

  it("webhook claim uses typed parameters (prepare:false) and enforces the lease model", async () => {
    const repo = createIdempotencyRepository(handle.db);
    const base = { provider: "asaas" as const, eventId: "evt_1", eventType: "payment.confirmed", signatureOk: true, leaseSeconds: 60, maxAttempts: 2 };
    const t0 = new Date();

    expect(await repo.claimOrResume({ ...base, now: t0 })).toEqual({ kind: "claimed" });
    expect(await repo.claimOrResume({ ...base, now: t0 })).toEqual({ kind: "currently_processing" });
    expect(await repo.claimOrResume({ ...base, now: new Date(t0.getTime() + 61_000) })).toEqual({ kind: "resumed" });
    await repo.markFailed("asaas", "evt_1", "boom");
    expect(await repo.claimOrResume({ ...base, now: t0 })).toEqual({ kind: "dead_letter" });

    expect(await repo.claimOrResume({ ...base, eventId: "evt_2", now: t0 })).toEqual({ kind: "claimed" });
    await repo.markProcessed("asaas", "evt_2", null);
    expect(await repo.claimOrResume({ ...base, eventId: "evt_2", now: t0 })).toEqual({ kind: "already_processed" });
  });

  it("scheduled purge nullifies expired triage and contact rows satisfying the CHECK constraints", async () => {
    await createTriageUnitOfWork(handle.db, enc).createSubmissionWithConsent({
      referenceCode: "PLM-OLD0-0001",
      idempotencyKey: crypto.randomUUID(),
      triage: { programInterest: "online", contactChannel: "email", contactPlaintext: "{}", retentionUntil: new Date(Date.now() - 1000) },
      consent,
    });
    await createDrizzleContactRepository(handle.db, enc).createWithConsent({
      referenceCode: "CTT-OLD0-0001",
      idempotencyKey: crypto.randomUUID(),
      contact: { subject: "Geral", contactPlaintext: "{}", messagePlaintext: "mensagem antiga", retentionUntil: new Date(Date.now() - 1000) },
      consent,
    });

    const result = await handleScheduledPurge(createDrizzlePurgeRepository(handle.db));
    expect(result).toEqual({ triagePurged: 1, contactsPurged: 1 });

    const triage = (await handle.db.execute(sql`SELECT status, reference_code, contact_ciphertext FROM triage_submissions`))[0];
    expect(triage).toEqual({ status: "purged", reference_code: null, contact_ciphertext: null });
    const contact = (await handle.db.execute(sql`SELECT status, message_ciphertext FROM contact_submissions`))[0];
    expect(contact).toEqual({ status: "purged", message_ciphertext: null });

    expect(await handleScheduledPurge(createDrizzlePurgeRepository(handle.db))).toEqual({ triagePurged: 0, contactsPurged: 0 });
  });

  it("retention: apaga pendentes antigas, anonimiza cancelamentos, limpa auditoria/webhooks e neutraliza o assunto do contato", async () => {
    const day = 86_400_000;
    const ago = (days: number) => new Date(Date.now() - days * day);
    const iso = (d: Date) => d.toISOString();

    // newsletter: 2 pendentes (8 e 2 dias), 2 canceladas (31 e 5 dias), 1 confirmada antiga
    await handle.db.execute(sql`INSERT INTO newsletter_subscriptions
      (email_hash, email_cipher, email_iv, key_version, status, created_at, confirm_sent_at, unsubscribed_at, unsubscribe_token_hash, confirm_token_hash) VALUES
      ('h-pend-old', 'c', 'i', 1, 'pending', ${iso(ago(8))}, ${iso(ago(8))}, NULL, 'ut1', 'ct1'),
      ('h-pend-new', 'c', 'i', 1, 'pending', ${iso(ago(2))}, ${iso(ago(2))}, NULL, 'ut2', 'ct2'),
      ('h-unsub-old', 'c', 'i', 1, 'unsubscribed', ${iso(ago(60))}, ${iso(ago(60))}, ${iso(ago(31))}, NULL, NULL),
      ('h-unsub-new', 'c', 'i', 1, 'unsubscribed', ${iso(ago(60))}, ${iso(ago(60))}, ${iso(ago(5))}, NULL, NULL),
      ('h-conf-old', 'c', 'i', 1, 'confirmed', ${iso(ago(400))}, ${iso(ago(400))}, NULL, 'ut5', NULL)`);

    // auditoria: uma de 400 dias e uma de 10 dias
    await handle.db.execute(sql`INSERT INTO audit_events (actor, action, entity_type, created_at) VALUES
      ('op', 'inbox.list', 'inbox', ${iso(ago(400))}), ('op', 'inbox.list', 'inbox', ${iso(ago(10))})`);

    // webhooks: processado antigo (apaga), falho antigo (mantém), processado recente (mantém)
    await handle.db.execute(sql`INSERT INTO payment_webhook_events (provider, event_id, event_type, received_at, process_status, signature_ok) VALUES
      ('asaas', 'e-old-ok', 't', ${iso(ago(400))}, 'processed', true),
      ('asaas', 'e-old-failed', 't', ${iso(ago(400))}, 'failed', true),
      ('asaas', 'e-new-ok', 't', ${iso(ago(5))}, 'processed', true)`);

    // contato vencido com assunto potencialmente pessoal
    await createDrizzleContactRepository(handle.db, enc).createWithConsent({
      referenceCode: "CTT-RET0-0001",
      idempotencyKey: crypto.randomUUID(),
      contact: { subject: "Meu nome é Fulano e preciso de ajuda", contactPlaintext: "{}", messagePlaintext: "msg", retentionUntil: new Date(Date.now() - 1000) },
      consent,
    });

    const retention = createDrizzleRetentionRepository(handle.db);
    const result = await handleScheduledPurge(createDrizzlePurgeRepository(handle.db), { retention });
    expect(result).toEqual({ triagePurged: 0, contactsPurged: 1, newsletterProcessed: 2, housekeepingDeleted: 2 });

    const news = await handle.db.execute(sql`SELECT email_hash, status, email_cipher, email_iv, key_version, purged_at IS NOT NULL AS purged,
      confirm_token_hash, unsubscribe_token_hash FROM newsletter_subscriptions ORDER BY email_hash`);
    expect(news.map((r) => (r as Record<string, unknown>).email_hash)).toEqual(["h-conf-old", "h-pend-new", "h-unsub-new", "h-unsub-old"]);
    const byHash = Object.fromEntries(news.map((r) => [String((r as Record<string, unknown>).email_hash), r as Record<string, unknown>]));
    expect(byHash["h-unsub-old"]).toMatchObject({ status: "unsubscribed", email_cipher: null, email_iv: null, key_version: null, purged: true });
    expect(byHash["h-unsub-new"]).toMatchObject({ email_cipher: "c", purged: false });
    expect(byHash["h-conf-old"]).toMatchObject({ status: "confirmed", email_cipher: "c", purged: false });

    expect(await handle.db.execute(sql`SELECT 1 FROM audit_events`)).toHaveLength(1);
    const hooks = await handle.db.execute(sql`SELECT event_id FROM payment_webhook_events ORDER BY event_id`);
    expect(hooks.map((r) => (r as Record<string, unknown>).event_id)).toEqual(["e-new-ok", "e-old-failed"]);

    const contact = (await handle.db.execute(sql`SELECT subject, status FROM contact_submissions`))[0];
    expect(contact).toEqual({ subject: "[removido]", status: "purged" });

    // idempotente: segunda execução não encontra mais nada
    expect(await handleScheduledPurge(createDrizzlePurgeRepository(handle.db), { retention })).toEqual({
      triagePurged: 0,
      contactsPurged: 0,
      newsletterProcessed: 0,
      housekeepingDeleted: 0,
    });
  });

  it("retention: quem se inscreve de novo depois da anonimização volta a ter o e-mail guardado cifrado", async () => {
    const repo = createDrizzleNewsletterRepository(handle.db, enc, hashEmail);
    const email = "pessoa@example.org";
    const now = new Date();
    const base = {
      email,
      policyVersion: "2026-09-19",
      consentedAt: now,
      confirmTokenHash: "c1",
      confirmExpiresAt: new Date(now.getTime() + 48 * 3_600_000),
      unsubscribeTokenHash: "u1",
      unsubscribeExpiresAt: new Date(now.getTime() + 180 * 86_400_000),
      resendCooldownSeconds: 0,
      now,
    };
    expect(await repo.upsertPending(base)).toEqual({ kind: "confirmation_required" });
    await repo.unsubscribe("u1", now);

    const retention = createDrizzleRetentionRepository(handle.db);
    const later = new Date(now.getTime() + 40 * 86_400_000);
    expect(await retention.anonymizeUnsubscribedNewsletter(new Date(later.getTime() - 30 * 86_400_000), later, 10)).toBe(1);
    const anon = (await handle.db.execute(sql`SELECT email_cipher, purged_at IS NOT NULL AS purged FROM newsletter_subscriptions`))[0];
    expect(anon).toEqual({ email_cipher: null, purged: true });

    expect(await repo.upsertPending({ ...base, confirmTokenHash: "c2", unsubscribeTokenHash: "u2", now: later })).toEqual({
      kind: "confirmation_required",
    });
    const back = (await handle.db.execute(sql`SELECT status, email_cipher IS NOT NULL AS has_cipher, purged_at IS NULL AS not_purged FROM newsletter_subscriptions`))[0];
    expect(back).toEqual({ status: "pending", has_cipher: true, not_purged: true });
  });

  it("withCreationLock serializes concurrent creations for the same intent and lets different intents run in parallel", async () => {
    const other = createDbClient(url as string);
    try {
      const a = createDrizzleDonationRepository(handle.db, enc, hashEmail);
      const b = createDrizzleDonationRepository(other.db, enc, hashEmail);
      const events: string[] = [];
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const intent = crypto.randomUUID();

      const first = a.withCreationLock(intent, async (repo) => {
        events.push("a:start");
        expect(await repo.findFirstCharge(crypto.randomUUID())).toBeNull(); // repositório da transação funciona
        await sleep(300);
        events.push("a:end");
      });
      await sleep(80);
      const second = b.withCreationLock(intent, async () => {
        events.push("b:start");
      });
      await Promise.all([first, second]);
      expect(events).toEqual(["a:start", "a:end", "b:start"]);

      const parallel: string[] = [];
      await Promise.all([
        a.withCreationLock(crypto.randomUUID(), async () => {
          parallel.push("x:start");
          await sleep(200);
          parallel.push("x:end");
        }),
        (async () => {
          await sleep(60);
          await b.withCreationLock(crypto.randomUUID(), async () => void parallel.push("y:start"));
        })(),
      ]);
      expect(parallel).toEqual(["x:start", "y:start", "x:end"]);
    } finally {
      await other.close();
    }
  });

  it("withCreationLock: transação ociosa além do teto é encerrada pelo Postgres e o bloqueio é liberado", async () => {
    // Clientes dedicados: o Postgres encerra a conexão ociosa de `a`, e isso não pode afetar o `handle` compartilhado.
    const victim = createDbClient(url as string);
    const other = createDbClient(url as string);
    try {
      const a = createDrizzleDonationRepository(victim.db, enc, hashEmail, { idleInTransactionTimeoutMs: 300 });
      const b = createDrizzleDonationRepository(other.db, enc, hashEmail, { lockTimeoutMs: 5000 });
      const intent = crypto.randomUUID();
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

      // Simula o Worker travado no gateway sob o bloqueio: nenhum comando SQL por mais tempo que o teto.
      // Rejeição capturada na hora: a conexão derrubada pelo servidor não pode virar "unhandled rejection".
      const stuck = a
        .withCreationLock(intent, async () => {
          await sleep(1200);
        })
        .then(
          () => "completed",
          () => "failed",
        );
      await sleep(80);
      const started = Date.now();
      const waiter = b.withCreationLock(intent, async () => "acquired");

      await expect(waiter).resolves.toBe("acquired");
      expect(Date.now() - started).toBeLessThan(1500); // liberou pelo teto, não pelo fim do `work` travado
      await expect(stuck).resolves.toBe("failed");
    } finally {
      await other.close();
      await victim.close().catch(() => undefined);
    }
  });

  it("purge alert log records alerts in audit_events and only matches the same step inside the window", async () => {
    const log = createDrizzlePurgeAlertLog(handle.db);
    const now = new Date();
    expect(await log.hasAlertSince("triage", new Date(now.getTime() - 86_400_000))).toBe(false);

    await log.recordAlert("triage", "ref12345", now);
    expect(await log.hasAlertSince("triage", new Date(now.getTime() - 86_400_000))).toBe(true);
    expect(await log.hasAlertSince("contacts", new Date(now.getTime() - 86_400_000))).toBe(false);
    expect(await log.hasAlertSince("triage", new Date(now.getTime() + 1000))).toBe(false);

    const row = (await handle.db.execute(sql`SELECT actor, action, entity_type, entity_id, metadata FROM audit_events`))[0];
    expect(row).toEqual({ actor: "system", action: "purge.alert_sent", entity_type: "purge", entity_id: null, metadata: { step: "triage", reference: "ref12345" } });
  });
});
