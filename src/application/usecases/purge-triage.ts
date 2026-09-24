// src/application/usecases/purge-triage.ts (§5.5)
// Caso de uso para expurgo criptográfico automatizado (Nível 3 de retenção)

export interface PurgeRepository {
  findExpiredSubmissions(asOfDate: Date): Promise<string[]>;
  purgeSubmission(id: string, params: {
    purgedAt: Date;
    purgeReason: string;
    purgePolicyVersion: string;
  }): Promise<boolean>;
}

export interface PurgeTriageInput {
  asOfDate?: Date;
  reason?: string;
  policyVersion?: string;
}

export interface PurgeTriageOutput {
  purgedCount: number;
  submissionIds: string[];
}

export function createPurgeTriageUseCase(repo: PurgeRepository) {
  return async function execute(input: PurgeTriageInput = {}): Promise<PurgeTriageOutput> {
    const asOfDate = input.asOfDate ?? new Date();
    const purgeReason = input.reason ?? "retencao_expirada_180_dias";
    const purgePolicyVersion = input.policyVersion ?? "2026-09-19";

    const expiredIds = await repo.findExpiredSubmissions(asOfDate);
    const purgedIds: string[] = [];

    for (const id of expiredIds) {
      const success = await repo.purgeSubmission(id, {
        purgedAt: new Date(),
        purgeReason,
        purgePolicyVersion,
      });

      if (success) {
        purgedIds.push(id);
      }
    }

    return {
      purgedCount: purgedIds.length,
      submissionIds: purgedIds,
    };
  };
}
