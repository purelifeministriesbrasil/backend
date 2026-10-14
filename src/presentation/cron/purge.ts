// src/presentation/cron/purge.ts (§5.5)
import type { PurgeRepository } from "../../application/usecases/purge-triage.js";
import { createPurgeTriageUseCase } from "../../application/usecases/purge-triage.js";
import type { ContactPurgeRepository } from "../../application/usecases/purge-contacts.js";
import { createPurgeContactsUseCase } from "../../application/usecases/purge-contacts.js";
import { log } from "../../infrastructure/observability/logger.js";

export async function handleScheduledPurge(
  repo: PurgeRepository & ContactPurgeRepository
): Promise<{ triagePurged: number; contactsPurged: number }> {
  const triage = await createPurgeTriageUseCase(repo)();
  const contacts = await createPurgeContactsUseCase(repo)();
  log("info", "cron.purge_completed", { triagePurged: triage.purgedCount, contactsPurged: contacts.purgedCount });
  return { triagePurged: triage.purgedCount, contactsPurged: contacts.purgedCount };
}
