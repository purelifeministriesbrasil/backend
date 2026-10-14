import type { ContactSubmission } from "../../schemas/index.js";
import type { ContactRepository } from "../ports/contact-repository.js";
import type { Notifier } from "../ports/notifier.js";
import type { UseCaseResult } from "../ports/result.js";
import { generateReferenceCode } from "../reference-code.js";

/** Mensagens de contato seguem a mesma janela de retenção da triagem (RN-002 estendida). */
export const CONTACT_RETENTION_DAYS = 180;

export interface SubmitContactDeps {
  repo: ContactRepository;
  notifier: Notifier | null;
  now?: () => Date;
}

export async function submitContact(
  input: ContactSubmission,
  idempotencyKey: string,
  deps: SubmitContactDeps
): Promise<UseCaseResult<{ referenceCode: string }, "contact_persistence_failed">> {
  const now = deps.now?.() ?? new Date();

  let outcome: { referenceCode: string; created: boolean };
  try {
    outcome = await deps.repo.createWithConsent({
      referenceCode: generateReferenceCode("CTT"),
      idempotencyKey,
      contact: {
        subject: input.subject,
        contactPlaintext: JSON.stringify({ fullName: input.fullName, email: input.email, phone: input.phone }),
        messagePlaintext: input.message,
        retentionUntil: new Date(now.getTime() + CONTACT_RETENTION_DAYS * 24 * 60 * 60 * 1000),
      },
      consent: {
        purpose: "retorno_de_contato_institucional",
        policyVersion: input.policyVersion,
        originRoute: "/contato/",
        grantedAt: now,
      },
    });
  } catch {
    return { ok: false, kind: "infrastructure", error: "contact_persistence_failed", retryable: true };
  }

  if (outcome.created && deps.notifier) {
    await deps.notifier.notifyStaff(
      `Nova mensagem de contato — ${outcome.referenceCode}`,
      `Uma nova mensagem pelo formulário de contato foi registrada com o código ${outcome.referenceCode}.\n` +
        "O conteúdo permanece cifrado no banco; consulte-o pela caixa pastoral."
    );
  }

  return { ok: true, value: { referenceCode: outcome.referenceCode } };
}
