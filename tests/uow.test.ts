import { describe, it, expect, vi } from "vitest";
import { createTriageUnitOfWork } from "../src/infrastructure/db/unit-of-work.js";
import { createAesGcmProvider } from "../src/infrastructure/crypto/aes-gcm.js";
import { triageSubmissions, triageConsents } from "../src/infrastructure/db/schema.js";

describe("Triage Unit of Work Atomic Transactions (§5.4)", () => {
  const testKeyV1 = btoa("12345678901234567890123456789012");
  const enc = createAesGcmProvider({ 1: testKeyV1 }, 1);

  it("executes submission and consent within a single atomic database transaction", async () => {
    const fixedId = "test-submission-uuid-1234";
    const operations: string[] = [];

    const mockTx = {
      insert: vi.fn((table: any) => ({
        values: vi.fn((values: any) => {
          if (table === triageSubmissions) {
            operations.push("insert_submission");
            return {
              returning: vi.fn(async () => [{ id: fixedId }]),
            };
          }
          if (table === triageConsents) {
            operations.push("insert_consent");
            expect(values.triageSubmissionId).toBe(fixedId);
            return Promise.resolve();
          }
          return Promise.resolve();
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((setValues: any) => {
          operations.push("update_ciphertexts");
          expect(setValues.contactCiphertext).toBeTruthy();
          expect(setValues.contactIv).toBeTruthy();
          return {
            where: vi.fn(async () => {}),
          };
        }),
      })),
    };

    const mockDb = {
      transaction: vi.fn(async (callback: any) => {
        operations.push("begin_transaction");
        const res = await callback(mockTx);
        operations.push("commit_transaction");
        return res;
      }),
    };

    const uow = createTriageUnitOfWork(mockDb as any, enc);

    const result = await uow.createSubmissionWithConsent({
      referenceCode: "PLM-123456",
      triage: {
        programInterest: "residencial",
        contactChannel: "whatsapp",
        contactPlaintext: JSON.stringify({ fullName: "João Silva", email: "joao@exemplo.com" }),
        reportPlaintext: "Pedido de ajuda pastoral",
        retentionUntil: new Date(),
      },
      consent: {
        purpose: "avaliacao_e_contato_para_aconselhamento",
        policyVersion: "2026-09-19",
        originRoute: "/triagem/",
        grantedAt: new Date(),
      },
    });

    expect(result.submissionId).toBe(fixedId);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);

    // Verifica a ordem atômica exata das operações dentro da transação
    expect(operations).toEqual([
      "begin_transaction",
      "insert_submission",
      "update_ciphertexts",
      "insert_consent",
      "commit_transaction",
    ]);
  });
});
