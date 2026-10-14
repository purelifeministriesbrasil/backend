import { describe, it, expect, vi } from "vitest";
import { createTriageUnitOfWork } from "../src/infrastructure/db/unit-of-work.js";
import { createAesGcmProvider } from "../src/infrastructure/crypto/aes-gcm.js";
import { triageSubmissions, triageConsents } from "../src/infrastructure/db/schema.js";
import { randomKeyB64 } from "./helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("Triage Unit of Work Atomic Transactions (§5.4)", () => {
  const enc = createAesGcmProvider({ 1: randomKeyB64() }, 1);
  const input = (idempotencyKey = crypto.randomUUID()) => ({
    referenceCode: "PLM-AAAA-BBBB",
    idempotencyKey,
    triage: {
      programInterest: "residencial" as const,
      contactChannel: "whatsapp" as const,
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

  function mockDb(opts: { conflict?: boolean; failConsent?: boolean }, operations: string[]) {
    const fixedId = "test-submission-uuid-1234";
    const tx = {
      insert: vi.fn((table: any) => ({
        values: vi.fn((values: any) => {
          if (table === triageSubmissions) {
            operations.push("insert_submission");
            expect(values.idempotencyKey).toBeTruthy();
            return {
              onConflictDoNothing: vi.fn(() => ({
                returning: vi.fn(async () => (opts.conflict ? [] : [{ id: fixedId }])),
              })),
            };
          }
          if (table === triageConsents) {
            if (opts.failConsent) {
              operations.push("insert_consent_fail");
              throw new Error("DB Connection Interrupted during consent recording");
            }
            operations.push("insert_consent");
            expect(values.triageSubmissionId).toBe(fixedId);
            return Promise.resolve();
          }
          return Promise.resolve();
        }),
      })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => {
            operations.push("select_existing");
            return [{ id: "existing-id", referenceCode: "PLM-EXIS-TING" }];
          }),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn((setValues: any) => {
          operations.push("update_ciphertexts");
          expect(setValues.contactCiphertext).toBeTruthy();
          expect(setValues.contactIv).toBeTruthy();
          expect(JSON.stringify(setValues)).not.toContain("João");
          return { where: vi.fn(async () => {}) };
        }),
      })),
    };
    return {
      transaction: vi.fn(async (callback: any) => {
        operations.push("begin_transaction");
        try {
          const res = await callback(tx);
          operations.push("commit_transaction");
          return res;
        } catch (err) {
          operations.push("rollback_transaction");
          throw err;
        }
      }),
    };
  }

  it("executes submission, ciphertexts and consent within a single atomic transaction", async () => {
    const operations: string[] = [];
    const db = mockDb({}, operations);
    const result = await createTriageUnitOfWork(db as any, enc).createSubmissionWithConsent(input());

    expect(result).toEqual({ submissionId: "test-submission-uuid-1234", referenceCode: "PLM-AAAA-BBBB", created: true });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(operations).toEqual([
      "begin_transaction",
      "insert_submission",
      "update_ciphertexts",
      "insert_consent",
      "commit_transaction",
    ]);
  });

  it("returns the previously issued reference code on idempotent replay without writing again", async () => {
    const operations: string[] = [];
    const db = mockDb({ conflict: true }, operations);
    const result = await createTriageUnitOfWork(db as any, enc).createSubmissionWithConsent(input());

    expect(result).toEqual({ submissionId: "existing-id", referenceCode: "PLM-EXIS-TING", created: false });
    expect(operations).toEqual(["begin_transaction", "insert_submission", "select_existing", "commit_transaction"]);
  });

  it("aborts and bubbles error if any step in the transaction fails (rollback guarantee)", async () => {
    const operations: string[] = [];
    const db = mockDb({ failConsent: true }, operations);

    await expect(createTriageUnitOfWork(db as any, enc).createSubmissionWithConsent(input())).rejects.toThrow(
      "DB Connection Interrupted during consent recording"
    );
    expect(operations).toEqual([
      "begin_transaction",
      "insert_submission",
      "update_ciphertexts",
      "insert_consent_fail",
      "rollback_transaction",
    ]);
  });
});
