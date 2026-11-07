import { describe, expect, it, vi } from "vitest";
import { handleScheduledPurge, PurgeStepsFailedError } from "../src/presentation/cron/purge.js";
import type { PurgeAlertLog } from "../src/application/ports/purge-alert-log.js";
import type { Notifier } from "../src/application/ports/notifier.js";

/** Repositório em memória: `triage`/`contacts` são filas de ids vencidos. */
function fakeRepo(triage: string[], contacts: string[]) {
  const failTriage = { find: false, purge: false };
  const failContacts = { find: false };
  return {
    failTriage,
    failContacts,
    findExpiredSubmissions: vi.fn(async (_d: Date, limit = 500) => {
      if (failTriage.find) throw Object.assign(new Error("db down: user@example.com"), { code: "57P01" });
      return triage.slice(0, limit);
    }),
    purgeSubmission: vi.fn(async (id: string) => {
      if (failTriage.purge) throw new Error("boom");
      const i = triage.indexOf(id);
      if (i >= 0) triage.splice(i, 1);
      return i >= 0;
    }),
    findExpiredContacts: vi.fn(async (_d: Date, limit: number) => {
      if (failContacts.find) throw new Error("contacts down");
      return contacts.slice(0, limit);
    }),
    purgeContact: vi.fn(async (id: string) => {
      const i = contacts.indexOf(id);
      if (i >= 0) contacts.splice(i, 1);
      return i >= 0;
    }),
  };
}

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

function notifierMock(sent = true): Notifier & { notifyStaff: ReturnType<typeof vi.fn> } {
  return { notifyStaff: vi.fn(async () => sent), sendToRecipient: vi.fn(async () => true) };
}

describe("cron de expurgo: etapas independentes", () => {
  it("falha na triagem não impede o expurgo de contatos e o erro final é lançado", async () => {
    const repo = fakeRepo(ids("t", 3), ids("c", 4));
    repo.failTriage.find = true;

    const err = await handleScheduledPurge(repo, { newReference: () => "ref12345" }).catch((e) => e);

    expect(err).toBeInstanceOf(PurgeStepsFailedError);
    expect(err.failedSteps).toEqual(["triage"]);
    expect(err.code).toBe("purge_steps_failed");
    expect(err.result).toEqual({ triagePurged: 0, contactsPurged: 4 });
    expect(repo.purgeContact).toHaveBeenCalledTimes(4);
  });

  it("falha em contatos não desfaz a triagem já concluída", async () => {
    const repo = fakeRepo(ids("t", 2), ids("c", 2));
    repo.failContacts.find = true;
    const err = await handleScheduledPurge(repo).catch((e) => e);
    expect(err.failedSteps).toEqual(["contacts"]);
    expect(err.result.triagePurged).toBe(2);
  });

  it("sem falhas devolve as contagens e não envia alerta", async () => {
    const notifier = notifierMock();
    const result = await handleScheduledPurge(fakeRepo(ids("t", 2), ids("c", 1)), { notifier });
    expect(result).toEqual({ triagePurged: 2, contactsPurged: 1 });
    expect(notifier.notifyStaff).not.toHaveBeenCalled();
  });
});

describe("cron de expurgo: lotes", () => {
  it("processa mais de um lote até esvaziar a fila", async () => {
    const repo = fakeRepo(ids("t", 1200), ids("c", 10));
    const result = await handleScheduledPurge(repo);
    expect(result).toEqual({ triagePurged: 1200, contactsPurged: 10 });
    expect(repo.findExpiredSubmissions).toHaveBeenCalledTimes(3); // 500 + 500 + 200
  });

  it("respeita o teto de lotes e a próxima execução continua sem perder registros", async () => {
    const queue = ids("t", 1200);
    const repo = fakeRepo(queue, []);
    const first = await handleScheduledPurge(repo, { maxBatches: 2 });
    expect(first.triagePurged).toBe(1000);
    expect(queue).toHaveLength(200);

    const second = await handleScheduledPurge(repo, { maxBatches: 2 });
    expect(second.triagePurged).toBe(200);
    expect(queue).toHaveLength(0);
  });

  it("para de iniciar lotes quando o tempo estoura", async () => {
    const repo = fakeRepo(ids("t", 2000), []);
    let tick = 0;
    const now = () => new Date(1_700_000_000_000 + tick++ * 15_000);
    const result = await handleScheduledPurge(repo, { now, timeBudgetMs: 20_000 });
    expect(result.triagePurged).toBeLessThan(2000);
    expect(result.triagePurged % 500).toBe(0);
  });

  it("não entra em laço quando o lote não avança", async () => {
    const repo = fakeRepo(["x"], []);
    repo.purgeSubmission.mockResolvedValue(false);
    const result = await handleScheduledPurge(repo, { batchSize: 1 });
    expect(result.triagePurged).toBe(0);
    expect(repo.findExpiredSubmissions).toHaveBeenCalledTimes(1);
  });
});

describe("cron de expurgo: alerta por e-mail", () => {
  const startedAt = new Date("2026-11-08T03:00:00.000Z");

  it("envia um único e-mail técnico, sem PII, e registra o alerta", async () => {
    const repo = fakeRepo(ids("t", 1), ids("c", 1));
    repo.failTriage.find = true;
    const notifier = notifierMock();
    const alertLog: PurgeAlertLog = { hasAlertSince: vi.fn(async () => false), recordAlert: vi.fn(async () => undefined) };

    await handleScheduledPurge(repo, { notifier, alertLog, now: () => startedAt, newReference: () => "ref12345" }).catch(() => undefined);

    expect(notifier.notifyStaff).toHaveBeenCalledTimes(1);
    const [subject, body] = notifier.notifyStaff.mock.calls[0] as [string, string];
    expect(subject).toContain("ref12345");
    expect(body).toContain("triagem");
    expect(body).toContain("57P01");
    expect(body).toContain("2026-11-08T03:00:00.000Z");
    expect(body).not.toContain("user@example.com"); // mensagem do erro nunca vai no e-mail
    expect(body).not.toContain("contatos (código");
    expect(alertLog.recordAlert).toHaveBeenCalledWith("triage", "ref12345", startedAt);
  });

  it("não repete o alerta da mesma etapa dentro da janela, mas o erro continua sendo lançado", async () => {
    const repo = fakeRepo(ids("t", 1), []);
    repo.failTriage.find = true;
    const notifier = notifierMock();
    const alertLog: PurgeAlertLog = { hasAlertSince: vi.fn(async () => true), recordAlert: vi.fn(async () => undefined) };

    const err = await handleScheduledPurge(repo, { notifier, alertLog }).catch((e) => e);

    expect(err).toBeInstanceOf(PurgeStepsFailedError);
    expect(notifier.notifyStaff).not.toHaveBeenCalled();
  });

  it("alerta mesmo se a consulta ao histórico falhar", async () => {
    const repo = fakeRepo(ids("t", 1), []);
    repo.failTriage.find = true;
    const notifier = notifierMock();
    const alertLog: PurgeAlertLog = {
      hasAlertSince: vi.fn(async () => {
        throw new Error("db");
      }),
      recordAlert: vi.fn(async () => undefined),
    };
    await handleScheduledPurge(repo, { notifier, alertLog }).catch(() => undefined);
    expect(notifier.notifyStaff).toHaveBeenCalledTimes(1);
  });

  it("falha do Resend ou ausência de notifier não esconde o erro nem grava alerta", async () => {
    const repo = fakeRepo(ids("t", 1), []);
    repo.failTriage.find = true;
    const alertLog: PurgeAlertLog = { hasAlertSince: vi.fn(async () => false), recordAlert: vi.fn(async () => undefined) };

    const e1 = await handleScheduledPurge(repo, { notifier: notifierMock(false), alertLog }).catch((e) => e);
    expect(e1).toBeInstanceOf(PurgeStepsFailedError);
    expect(alertLog.recordAlert).not.toHaveBeenCalled();

    const e2 = await handleScheduledPurge(repo, { notifier: null }).catch((e) => e);
    expect(e2).toBeInstanceOf(PurgeStepsFailedError);
  });
});
