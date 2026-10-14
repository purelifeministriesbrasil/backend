import type { ConsentDraft } from "./triage-unit-of-work.js";

export interface ContactDraft {
  subject: string;
  contactPlaintext: string; // JSON com nome, e-mail e telefone
  messagePlaintext: string;
  retentionUntil: Date;
}

export interface ContactRepository {
  /** Persiste mensagem cifrada + consentimento numa transação; idempotente por `idempotencyKey`. */
  createWithConsent(input: {
    contact: ContactDraft;
    consent: ConsentDraft;
    referenceCode: string;
    idempotencyKey: string;
  }): Promise<{ submissionId: string; referenceCode: string; created: boolean }>;
}
