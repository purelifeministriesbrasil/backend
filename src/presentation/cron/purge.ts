// src/presentation/cron/purge.ts (§5.5)
// Triagem e contatos são etapas independentes: a falha de uma não impede a outra. Cada etapa processa
// lotes até esvaziar a fila ou atingir o teto de lotes/tempo; o que sobrar continua na execução seguinte,
// porque a seleção é sempre "vencido e ainda não expurgado" (nada é marcado antes do expurgo efetivo).
import type { PurgeRepository } from "../../application/usecases/purge-triage.js";
import { createPurgeTriageUseCase } from "../../application/usecases/purge-triage.js";
import type { ContactPurgeRepository } from "../../application/usecases/purge-contacts.js";
import { createPurgeContactsUseCase } from "../../application/usecases/purge-contacts.js";
import type { Notifier } from "../../application/ports/notifier.js";
import type { PurgeAlertLog } from "../../application/ports/purge-alert-log.js";
import { errorCode, log } from "../../infrastructure/observability/logger.js";

export type PurgeStep = "triage" | "contacts";

const STEP_LABEL: Record<PurgeStep, string> = { triage: "triagem", contacts: "contatos" };

export interface PurgeRunOptions {
  /** Registros por lote (padrão 500). */
  batchSize?: number;
  /** Teto de lotes por etapa e por execução (padrão 10 = até 5.000 registros por etapa). */
  maxBatches?: number;
  /** Teto de tempo (relógio) antes de iniciar um novo lote, em ms (padrão 20 s). */
  timeBudgetMs?: number;
  /** Intervalo mínimo entre alertas da mesma etapa, em ms (padrão 3 dias). */
  alertCooldownMs?: number;
  notifier?: Notifier | null;
  alertLog?: PurgeAlertLog;
  now?: () => Date;
  newReference?: () => string;
}

export interface PurgeRunResult {
  triagePurged: number;
  contactsPurged: number;
}

/** Lançado ao final quando alguma etapa falhou; leva só nomes de etapas e códigos técnicos. */
export class PurgeStepsFailedError extends Error {
  readonly code = "purge_steps_failed";
  constructor(
    readonly failedSteps: PurgeStep[],
    readonly reference: string,
    readonly result: PurgeRunResult
  ) {
    super(`Etapas do expurgo com falha: ${failedSteps.join(", ")} (ref. ${reference})`);
    this.name = "PurgeStepsFailedError";
  }
}

const DEFAULTS = {
  batchSize: 500,
  maxBatches: 10,
  timeBudgetMs: 20_000,
  alertCooldownMs: 3 * 24 * 60 * 60 * 1000,
};

export async function handleScheduledPurge(
  repo: PurgeRepository & ContactPurgeRepository,
  options: PurgeRunOptions = {}
): Promise<PurgeRunResult> {
  const batchSize = options.batchSize ?? DEFAULTS.batchSize;
  const maxBatches = options.maxBatches ?? DEFAULTS.maxBatches;
  const timeBudgetMs = options.timeBudgetMs ?? DEFAULTS.timeBudgetMs;
  const now = options.now ?? (() => new Date());
  const reference = (options.newReference ?? (() => crypto.randomUUID().slice(0, 8)))();
  const startedAt = now();

  const triageUseCase = createPurgeTriageUseCase(repo);
  const contactsUseCase = createPurgeContactsUseCase(repo);

  const counts: Record<PurgeStep, number> = { triage: 0, contacts: 0 };
  const failures: { step: PurgeStep; code: string }[] = [];

  async function drain(step: PurgeStep, runBatch: (limit: number) => Promise<number>): Promise<void> {
    try {
      for (let batch = 0; batch < maxBatches; batch++) {
        if (batch > 0 && now().getTime() - startedAt.getTime() >= timeBudgetMs) {
          log("warn", "cron.purge_budget_reached", { step, reference, purgedSoFar: counts[step] });
          return;
        }
        const purged = await runBatch(batchSize);
        counts[step] += purged;
        // Lote incompleto: fila esvaziada (ou sem progresso); a próxima execução retoma o que restar.
        if (purged < batchSize) return;
      }
      log("warn", "cron.purge_batch_cap_reached", { step, reference, purgedSoFar: counts[step] });
    } catch (err) {
      const code = errorCode(err);
      failures.push({ step, code });
      log("error", "cron.purge_step_failed", { step, reference, code, purgedSoFar: counts[step] });
    }
  }

  await drain("triage", async (limit) => (await triageUseCase({ limit })).purgedCount);
  await drain("contacts", async (limit) => (await contactsUseCase({ limit })).purgedCount);

  const result: PurgeRunResult = { triagePurged: counts.triage, contactsPurged: counts.contacts };
  log("info", "cron.purge_completed", { ...result, reference, failedSteps: failures.map((f) => f.step) });

  if (failures.length > 0) {
    await alertStaff(failures, reference, startedAt, result, options);
    throw new PurgeStepsFailedError(
      failures.map((f) => f.step),
      reference,
      result
    );
  }
  return result;
}

/** E-mail único por execução, só com dados técnicos; etapas já alertadas dentro da janela são omitidas. */
async function alertStaff(
  failures: { step: PurgeStep; code: string }[],
  reference: string,
  startedAt: Date,
  result: PurgeRunResult,
  options: PurgeRunOptions
): Promise<void> {
  const { notifier, alertLog } = options;
  if (!notifier) {
    log("warn", "cron.purge_alert_unavailable", { reference });
    return;
  }
  try {
    const cooldown = options.alertCooldownMs ?? DEFAULTS.alertCooldownMs;
    const since = new Date(startedAt.getTime() - cooldown);
    const toAlert: typeof failures = [];
    for (const failure of failures) {
      // Falha ao consultar o histórico não pode silenciar o alerta: na dúvida, avisa.
      const recent = alertLog ? await alertLog.hasAlertSince(failure.step, since).catch(() => false) : false;
      if (!recent) toAlert.push(failure);
    }
    if (toAlert.length === 0) {
      log("info", "cron.purge_alert_suppressed", { reference });
      return;
    }

    const lines = [
      `Referência: ${reference}`,
      `Execução (UTC): ${startedAt.toISOString()}`,
      "",
      "Etapas com falha:",
      ...toAlert.map((f) => `- ${STEP_LABEL[f.step]} (código técnico: ${f.code})`),
      "",
      `Registros expurgados nesta execução: triagem ${result.triagePurged}, contatos ${result.contactsPurged}.`,
      "A outra etapa foi executada normalmente. O que ficou pendente será retomado na próxima execução diária.",
      `Procure a referência ${reference} nos logs do Worker. Este aviso não contém dados pessoais.`,
    ];
    const sent = await notifier.notifyStaff(`[Pure Life] Falha no expurgo diário (ref. ${reference})`, lines.join("\n"));
    if (!sent) {
      log("warn", "cron.purge_alert_not_sent", { reference });
      return;
    }
    if (alertLog) {
      for (const f of toAlert) await alertLog.recordAlert(f.step, reference, startedAt).catch(() => undefined);
    }
  } catch (err) {
    log("warn", "cron.purge_alert_failed", { reference, code: errorCode(err) });
  }
}
