import { describe, it, expect, vi } from "vitest";
import { handleTriageSubmission } from "../src/presentation/forms/triagem.js";
import { createTriageUnitOfWork } from "../src/infrastructure/db/unit-of-work.js";
import { createAesGcmProvider } from "../src/infrastructure/crypto/aes-gcm.js";
import { triageSubmissions } from "../src/infrastructure/db/schema.js";
import { SITE, failTurnstile, jsonRequest, passTurnstile, randomKeyB64, recordingNotifier, validTriage } from "./helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Banco simulado que registra o que seria gravado: permite inspecionar se há PII em claro. */
function recordingDb() {
  const writes: unknown[] = [];
  const byKey = new Map<string, { id: string; referenceCode: string }>();
  let lastKey = "";
  const tx = {
    insert: (table: unknown) => ({
      values: (values: any) => {
        writes.push(values);
        if (table === triageSubmissions) {
          lastKey = values.idempotencyKey;
          const existing = byKey.get(values.idempotencyKey);
          return {
            onConflictDoNothing: () => ({
              returning: async () => {
                if (existing) return [];
                const row = { id: crypto.randomUUID(), referenceCode: values.referenceCode };
                byKey.set(values.idempotencyKey, row);
                return [{ id: row.id }];
              },
            }),
          };
        }
        return Promise.resolve();
      },
    }),
    update: () => ({ set: (values: unknown) => (writes.push(values), { where: async () => {} }) }),
    select: () => ({ from: () => ({ where: async () => [byKey.get(lastKey)] }) }),
  };
  return { writes, db: { transaction: async (cb: (t: typeof tx) => unknown) => cb(tx) } };
}

describe("POST /api/forms/triagem (ponta a ponta com UoW e cifra reais)", () => {
  const env = { PUBLIC_SITE_ORIGIN: SITE };
  const enc = createAesGcmProvider({ 1: randomKeyB64() }, 1);

  it("encrypts contact and report before persisting and returns a CSPRNG reference code", async () => {
    const { writes, db } = recordingDb();
    const notifier = recordingNotifier();
    const res = await handleTriageSubmission(
      jsonRequest("/api/forms/triagem", validTriage, { "Idempotency-Key": crypto.randomUUID() }),
      env,
      { turnstile: passTurnstile, triage: () => ({ uow: createTriageUnitOfWork(db as any, enc), notifier }) }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { referenceCode: string };
    expect(body.referenceCode).toMatch(/^PLM-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    const persisted = JSON.stringify(writes);
    expect(persisted).not.toContain(validTriage.fullName);
    expect(persisted).not.toContain(validTriage.email);
    expect(persisted).not.toContain(validTriage.report);
    expect(persisted).not.toContain("99999");
    expect(notifier.sent).toHaveLength(1);
  });

  it("returns the same reference code for an idempotent retry and does not notify twice", async () => {
    const { db } = recordingDb();
    const notifier = recordingNotifier();
    const key = crypto.randomUUID();
    const deps = { turnstile: passTurnstile, triage: () => ({ uow: createTriageUnitOfWork(db as any, enc), notifier }) };

    const a = (await (await handleTriageSubmission(jsonRequest("/api/forms/triagem", validTriage, { "Idempotency-Key": key }), env, deps)).json()) as { referenceCode: string };
    const b = (await (await handleTriageSubmission(jsonRequest("/api/forms/triagem", validTriage, { "Idempotency-Key": key }), env, deps)).json()) as { referenceCode: string };
    expect(b.referenceCode).toBe(a.referenceCode);
    expect(notifier.sent).toHaveLength(1);
  });

  it("rejects minors (isAdult must be literally true)", async () => {
    const res = await handleTriageSubmission(
      jsonRequest("/api/forms/triagem", { ...validTriage, isAdult: false }, { "Idempotency-Key": crypto.randomUUID() }),
      env,
      { turnstile: passTurnstile, triage: () => ({ uow: { createSubmissionWithConsent: vi.fn() }, notifier: null }) }
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { fields: Record<string, string> }).fields.isAdult).toBe(
      "Este formulário é destinado a maiores de 18 anos."
    );
  });

  it("does not echo submitted values in validation errors", async () => {
    const res = await handleTriageSubmission(
      jsonRequest("/api/forms/triagem", { ...validTriage, phone: "SEGREDO-123" }, { "Idempotency-Key": crypto.randomUUID() }),
      env,
      { turnstile: passTurnstile, triage: () => ({ uow: { createSubmissionWithConsent: vi.fn() }, notifier: null }) }
    );
    expect(res.status).toBe(422);
    expect(await res.text()).not.toContain("SEGREDO-123");
  });

  it("returns 403 when Turnstile fails", async () => {
    const uow = { createSubmissionWithConsent: vi.fn() };
    const res = await handleTriageSubmission(
      jsonRequest("/api/forms/triagem", validTriage, { "Idempotency-Key": crypto.randomUUID() }),
      env,
      { turnstile: failTurnstile, triage: () => ({ uow, notifier: null }) }
    );
    expect(res.status).toBe(403);
    expect(uow.createSubmissionWithConsent).not.toHaveBeenCalled();
  });

  it("returns a generic 500 when the transaction fails, never the driver message", async () => {
    const uow = {
      createSubmissionWithConsent: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED db.internal:5432 user=postgres");
      }),
    };
    const res = await handleTriageSubmission(
      jsonRequest("/api/forms/triagem", validTriage, { "Idempotency-Key": crypto.randomUUID() }),
      env,
      { turnstile: passTurnstile, triage: () => ({ uow, notifier: null }) }
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("postgres");
  });

  it("rejects non-JSON content types and invalid JSON", async () => {
    const deps = { turnstile: passTurnstile, triage: () => ({ uow: { createSubmissionWithConsent: vi.fn() }, notifier: null }) };
    const wrongType = await handleTriageSubmission(
      jsonRequest("/api/forms/triagem", validTriage, { "Idempotency-Key": crypto.randomUUID(), "Content-Type": "text/plain" }),
      env,
      deps
    );
    expect(wrongType.status).toBe(415);

    const badJson = await handleTriageSubmission(
      jsonRequest("/api/forms/triagem", "{not json", { "Idempotency-Key": crypto.randomUUID() }),
      env,
      deps
    );
    expect(badJson.status).toBe(400);
  });
});
