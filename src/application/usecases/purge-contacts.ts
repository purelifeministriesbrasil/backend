// Expurgo LGPD de mensagens de contato com retenção expirada (análogo a purge-triage, §5.5).

export interface ContactPurgeRepository {
  findExpiredContacts(asOfDate: Date, limit: number): Promise<string[]>;
  /** Nulifica ciphertexts e código de referência; retorna `false` se já estava expurgado. */
  purgeContact(id: string, purgedAt: Date): Promise<boolean>;
}

export function createPurgeContactsUseCase(repo: ContactPurgeRepository) {
  return async function execute(
    input: { asOfDate?: Date; limit?: number } = {}
  ): Promise<{ purgedCount: number; submissionIds: string[] }> {
    const expiredIds = await repo.findExpiredContacts(input.asOfDate ?? new Date(), input.limit ?? 500);
    const purgedIds: string[] = [];

    for (const id of expiredIds) {
      if (await repo.purgeContact(id, new Date())) purgedIds.push(id);
    }

    return { purgedCount: purgedIds.length, submissionIds: purgedIds };
  };
}
