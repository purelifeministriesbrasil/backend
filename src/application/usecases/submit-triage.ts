import type { TriageSubmission } from "../../schemas/index.js";
import type { TriageUnitOfWork } from "../ports/triage-unit-of-work.js";
import type { UseCaseResult } from "../ports/result.js";

export interface SubmitTriageDeps {
  uow: TriageUnitOfWork;
}

export async function submitTriage(
  input: TriageSubmission,
  deps: SubmitTriageDeps
): Promise<UseCaseResult<{ referenceCode: string }>> {
  // Gera código amigável para o solicitante acompanhar com sigilo
  const referenceCode = `PLM-${Math.floor(100000 + Math.random() * 900000)}`;

  // Retenção canônica de 180 dias (§5.5)
  const retentionUntil = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

  const contactData = {
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    profile: input.profile,
  };

  try {
    await deps.uow.createSubmissionWithConsent({
      referenceCode,
      triage: {
        programInterest: input.programInterest,
        contactChannel: input.contactChannel,
        contactPlaintext: JSON.stringify(contactData),
        reportPlaintext: input.report,
        retentionUntil,
      },
      consent: {
        purpose: "avaliacao_e_contato_para_aconselhamento",
        policyVersion: input.policyVersion,
        originRoute: "/triagem/",
        grantedAt: new Date(),
      },
    });

    return {
      ok: true,
      value: { referenceCode },
    };
  } catch (err: unknown) {
    return {
      ok: false,
      kind: "infrastructure",
      error: err instanceof Error ? err.message : "triage_uow_failed",
      retryable: true,
    };
  }
}
