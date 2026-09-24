// src/presentation/cron/purge.ts (§5.5)
import type { PurgeRepository, PurgeTriageOutput } from "../../application/usecases/purge-triage.js";
import { createPurgeTriageUseCase } from "../../application/usecases/purge-triage.js";

export async function handleScheduledPurge(repo: PurgeRepository): Promise<PurgeTriageOutput> {
  const purgeUseCase = createPurgeTriageUseCase(repo);
  const result = await purgeUseCase();
  console.log(`[Cron Purge] Executado com sucesso. Expurgados ${result.purgedCount} registros de triagem.`);
  return result;
}
