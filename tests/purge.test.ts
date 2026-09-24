import { describe, it, expect, vi } from "vitest";
import { createPurgeTriageUseCase } from "../src/application/usecases/purge-triage.js";

describe("Triage Cryptographic Purge (§5.5)", () => {
  it("expunges expired submissions and nullifies all identifiable fields", async () => {
    const expiredId = "submission-uuid-expired-1";
    const purgedRecords: Record<string, any>[] = [];

    const mockRepo = {
      findExpiredSubmissions: vi.fn(async (asOfDate: Date) => [expiredId]),
      purgeSubmission: vi.fn(async (id: string, params: any) => {
        purgedRecords.push({
          id,
          status: "purged",
          referenceCode: null,
          programInterest: null,
          contactChannel: null,
          contactCiphertext: null,
          contactIv: null,
          reportCiphertext: null,
          reportIv: null,
          keyVersion: null,
          ...params,
        });
        return true;
      }),
    };

    const purgeUseCase = createPurgeTriageUseCase(mockRepo);
    const result = await purgeUseCase({
      asOfDate: new Date(),
      reason: "retencao_180_dias_expirada",
      policyVersion: "2026-09-19",
    });

    expect(result.purgedCount).toBe(1);
    expect(result.submissionIds).toEqual([expiredId]);
    expect(mockRepo.findExpiredSubmissions).toHaveBeenCalledTimes(1);
    expect(mockRepo.purgeSubmission).toHaveBeenCalledWith(
      expiredId,
      expect.objectContaining({
        purgeReason: "retencao_180_dias_expirada",
        purgePolicyVersion: "2026-09-19",
      })
    );

    // Validação estrita da regra CHECK (triage_purged_clean)
    const purged = purgedRecords[0];
    expect(purged.status).toBe("purged");
    expect(purged.referenceCode).toBeNull();
    expect(purged.contactCiphertext).toBeNull();
    expect(purged.reportCiphertext).toBeNull();
    expect(purged.contactIv).toBeNull();
    expect(purged.reportIv).toBeNull();
    expect(purged.contactChannel).toBeNull();
    expect(purged.programInterest).toBeNull();
    expect(purged.purgedAt).toBeInstanceOf(Date);
  });

  it("handles empty queue cleanly when no submissions have expired", async () => {
    const mockRepo = {
      findExpiredSubmissions: vi.fn(async () => []),
      purgeSubmission: vi.fn(),
    };

    const purgeUseCase = createPurgeTriageUseCase(mockRepo);
    const result = await purgeUseCase({
      asOfDate: new Date(),
      reason: "rotina_diaria_limpeza",
      policyVersion: "2026-09-19",
    });

    expect(result.purgedCount).toBe(0);
    expect(result.submissionIds).toEqual([]);
    expect(mockRepo.findExpiredSubmissions).toHaveBeenCalledTimes(1);
    expect(mockRepo.purgeSubmission).not.toHaveBeenCalled();
  });

  it("correctly purges multiple expired records in sequence", async () => {
    const expiredIds = ["expired-id-1", "expired-id-2", "expired-id-3"];
    const purgedIds: string[] = [];

    const mockRepo = {
      findExpiredSubmissions: vi.fn(async () => expiredIds),
      purgeSubmission: vi.fn(async (id: string) => {
        purgedIds.push(id);
        return true;
      }),
    };

    const purgeUseCase = createPurgeTriageUseCase(mockRepo);
    const result = await purgeUseCase({
      asOfDate: new Date(),
      reason: "retencao_180_dias_expirada",
      policyVersion: "2026-09-19",
    });

    expect(result.purgedCount).toBe(3);
    expect(result.submissionIds).toEqual(expiredIds);
    expect(purgedIds).toEqual(expiredIds);
    expect(mockRepo.purgeSubmission).toHaveBeenCalledTimes(3);
  });
});
