export interface TriageDraft {
  programInterest: "residencial" | "online" | "esposas" | "indefinido";
  contactChannel: "email" | "telefone" | "whatsapp";
  contactPlaintext: string; // JSON serializado com nome, email, telefone, etc.
  reportPlaintext?: string;
  retentionUntil: Date;
}

export interface ConsentDraft {
  purpose: string;
  policyVersion: string;
  originRoute: string;
  grantedAt: Date;
}

export interface TriageUnitOfWork {
  /**
   * Insere submissão + consentimento + cifra (que depende do id real da entidade) numa transação única.
   * Idempotente por `idempotencyKey`: uma retentativa devolve o código já emitido com `created: false`.
   */
  createSubmissionWithConsent(input: {
    triage: TriageDraft;
    consent: ConsentDraft;
    referenceCode: string;
    idempotencyKey: string;
  }): Promise<{ submissionId: string; referenceCode: string; created: boolean }>;
}
