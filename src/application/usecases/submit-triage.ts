import type { TriageSubmission } from "../../schemas/index.js";
import type { TriageUnitOfWork } from "../ports/triage-unit-of-work.js";
import type { DeferTask, Notifier } from "../ports/notifier.js";
import type { UseCaseResult } from "../ports/result.js";
import { generateReferenceCode } from "../reference-code.js";

/** Retenção canônica de 180 dias (§5.5, RN-002). */
export const TRIAGE_RETENTION_DAYS = 180;

export interface SubmitTriageDeps {
  uow: TriageUnitOfWork;
  notifier: Notifier | null;
  /** Quando presente, o aviso à equipe sai depois da resposta: o usuário não espera o Resend. */
  defer?: DeferTask;
  now?: () => Date;
}

export async function submitTriage(
  input: TriageSubmission,
  idempotencyKey: string,
  deps: SubmitTriageDeps
): Promise<UseCaseResult<{ referenceCode: string }, "triage_persistence_failed">> {
  const now = deps.now?.() ?? new Date();
  const retentionUntil = new Date(now.getTime() + TRIAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const contactData = {
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    profile: input.profile,
  };

  let outcome: { referenceCode: string; created: boolean };
  try {
    outcome = await deps.uow.createSubmissionWithConsent({
      referenceCode: generateReferenceCode("PLM"),
      idempotencyKey,
      triage: {
        programInterest: input.programInterest,
        contactChannel: input.contactChannel,
        contactPlaintext: JSON.stringify(contactData),
        reportPlaintext: input.report || undefined,
        retentionUntil,
      },
      consent: {
        purpose: "avaliacao_e_contato_para_aconselhamento",
        policyVersion: input.policyVersion,
        originRoute: "/triagem/",
        grantedAt: now,
      },
    });
  } catch {
    // A causa é registrada pelo adaptador; ao cliente só chega um código estável e sem detalhes.
    return { ok: false, kind: "infrastructure", error: "triage_persistence_failed", retryable: true };
  }

  if (outcome.created && deps.notifier) {
    // Somente o código de referência: nenhum dado pessoal ou relato trafega por e-mail (US-5.5).
    const notification = deps.notifier.notifyStaff(
      `Nova solicitação de triagem — ${outcome.referenceCode}`,
      `Uma nova solicitação confidencial de triagem foi registrada com o código ${outcome.referenceCode}.\n` +
        "Acesse a caixa pastoral para atendê-la. Este e-mail não contém dados pessoais por política de sigilo."
    );
    // O registro já está gravado; falha de e-mail é logada pelo adaptador e não altera a resposta.
    if (deps.defer) await deps.defer(notification);
    else await notification;
  }

  return { ok: true, value: { referenceCode: outcome.referenceCode } };
}
