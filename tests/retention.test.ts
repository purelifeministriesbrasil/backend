import { describe, expect, it, vi } from "vitest";
import {
  AUDIT_RETENTION_DAYS,
  NEWSLETTER_PENDING_RETENTION_DAYS,
  NEWSLETTER_UNSUBSCRIBED_RETENTION_DAYS,
  PURGED_CONTACT_SUBJECT,
  WEBHOOK_RETENTION_DAYS,
  cutoff,
} from "../src/application/retention-policy.js";
import { createRetentionUseCases } from "../src/application/usecases/apply-retention.js";
import type { RetentionRepository } from "../src/application/ports/retention-repository.js";
import { handleScheduledPurge, PurgeStepsFailedError } from "../src/presentation/cron/purge.js";

const DAY = 86_400_000;
const NOW = new Date("2026-12-01T12:00:00.000Z");

function repoMock(overrides: Partial<RetentionRepository> = {}): RetentionRepository & {
  [K in keyof RetentionRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    deleteStalePendingNewsletter: vi.fn(async () => 0),
    anonymizeUnsubscribedNewsletter: vi.fn(async () => 0),
    deleteAuditEvents: vi.fn(async () => 0),
    deleteFinishedWebhookEvents: vi.fn(async () => 0),
    ...overrides,
  } as never;
}

const emptyPurgeRepo = {
  findExpiredSubmissions: vi.fn(async () => []),
  purgeSubmission: vi.fn(async () => false),
  findExpiredContacts: vi.fn(async () => []),
  purgeContact: vi.fn(async () => false),
};

describe("prazos de retenção adotados em 21/11/2026", () => {
  it("têm os valores decididos", () => {
    expect(NEWSLETTER_PENDING_RETENTION_DAYS).toBe(7);
    expect(NEWSLETTER_UNSUBSCRIBED_RETENTION_DAYS).toBe(30);
    expect(AUDIT_RETENTION_DAYS).toBe(365);
    expect(WEBHOOK_RETENTION_DAYS).toBe(365);
    expect(PURGED_CONTACT_SUBJECT).toBe("[removido]");
  });

  it("cutoff subtrai dias exatos", () => {
    expect(cutoff(NOW, 7).getTime()).toBe(NOW.getTime() - 7 * DAY);
  });
});

describe("casos de uso de retenção", () => {
  it("newsletter usa os cortes de 7 e 30 dias e soma os tratados", async () => {
    const repo = repoMock({
      deleteStalePendingNewsletter: vi.fn(async () => 3),
      anonymizeUnsubscribedNewsletter: vi.fn(async () => 2),
    });
    const total = await createRetentionUseCases(repo).newsletter({ now: NOW, limit: 50 });
    expect(total).toBe(5);
    expect(repo.deleteStalePendingNewsletter).toHaveBeenCalledWith(new Date(NOW.getTime() - 7 * DAY), 50);
    expect(repo.anonymizeUnsubscribedNewsletter).toHaveBeenCalledWith(new Date(NOW.getTime() - 30 * DAY), NOW, 50);
  });

  it("housekeeping usa o corte de 1 ano para auditoria e webhooks", async () => {
    const repo = repoMock({ deleteAuditEvents: vi.fn(async () => 4), deleteFinishedWebhookEvents: vi.fn(async () => 1) });
    expect(await createRetentionUseCases(repo).housekeeping({ now: NOW })).toBe(5);
    expect(repo.deleteAuditEvents).toHaveBeenCalledWith(new Date(NOW.getTime() - 365 * DAY), 500);
    expect(repo.deleteFinishedWebhookEvents).toHaveBeenCalledWith(new Date(NOW.getTime() - 365 * DAY), 500);
  });
});

describe("expurgo diário com retenção", () => {
  it("sem retention, o resultado mantém o formato antigo", async () => {
    expect(await handleScheduledPurge(emptyPurgeRepo)).toEqual({ triagePurged: 0, contactsPurged: 0 });
  });

  it("com retention, informa os totais e processa em lotes até esvaziar", async () => {
    const calls: number[] = [];
    const repo = repoMock({
      deleteStalePendingNewsletter: vi.fn(async () => {
        calls.push(1);
        return calls.length === 1 ? 2 : 0; // lote cheio na primeira vez (batchSize 2), vazio depois
      }),
      deleteAuditEvents: vi.fn(async () => 1),
    });
    const result = await handleScheduledPurge(emptyPurgeRepo, { retention: repo, batchSize: 2, now: () => NOW });
    expect(result).toEqual({ triagePurged: 0, contactsPurged: 0, newsletterProcessed: 2, housekeepingDeleted: 1 });
  });

  it("falha na newsletter não impede a auditoria e vira alerta sem dados pessoais", async () => {
    const repo = repoMock({
      deleteStalePendingNewsletter: vi.fn(async () => {
        throw new Error("falha simulada");
      }),
      deleteAuditEvents: vi.fn(async () => 7),
    });
    const notifier = { notifyStaff: vi.fn(async () => true), sendToRecipient: vi.fn(async () => true) };

    const error = await handleScheduledPurge(emptyPurgeRepo, { retention: repo, notifier, now: () => NOW }).catch((e) => e);

    expect(error).toBeInstanceOf(PurgeStepsFailedError);
    expect((error as PurgeStepsFailedError).failedSteps).toEqual(["newsletter"]);
    expect((error as PurgeStepsFailedError).result).toMatchObject({ housekeepingDeleted: 7 });
    expect(repo.deleteAuditEvents).toHaveBeenCalled();
    const [subject, text] = notifier.notifyStaff.mock.calls[0] as unknown as [string, string];
    expect(subject).toContain("Falha no expurgo diário");
    expect(text).toContain("newsletter");
    expect(text).not.toContain("falha simulada");
  });
});
