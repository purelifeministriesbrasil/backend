import { describe, it, expect, vi } from "vitest";
import { handleContactSubmission } from "../src/presentation/forms/contato.js";
import type { ContactRepository } from "../src/application/ports/contact-repository.js";
import { SITE, failTurnstile, jsonRequest, passTurnstile, recordingNotifier, validContact } from "./helpers.js";

function inMemoryRepo(): ContactRepository & { rows: Map<string, { referenceCode: string; messagePlaintext: string }> } {
  const rows = new Map<string, { referenceCode: string; messagePlaintext: string }>();
  return {
    rows,
    createWithConsent: vi.fn(async ({ idempotencyKey, referenceCode, contact }) => {
      const existing = rows.get(idempotencyKey);
      if (existing) return { submissionId: idempotencyKey, referenceCode: existing.referenceCode, created: false };
      rows.set(idempotencyKey, { referenceCode, messagePlaintext: contact.messagePlaintext });
      return { submissionId: idempotencyKey, referenceCode, created: true };
    }),
  };
}

describe("POST /api/forms/contato", () => {
  const env = { PUBLIC_SITE_ORIGIN: SITE };

  it("persists the message, notifies staff without PII and returns a reference code", async () => {
    const repo = inMemoryRepo();
    const notifier = recordingNotifier();
    const res = await handleContactSubmission(
      jsonRequest("/api/forms/contato", validContact, { "Idempotency-Key": crypto.randomUUID() }),
      env,
      { turnstile: passTurnstile, contact: () => ({ repo, notifier }) }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; referenceCode: string };
    expect(body.ok).toBe(true);
    expect(body.referenceCode).toMatch(/^CTT-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(repo.rows.size).toBe(1);
    expect(notifier.sent).toHaveLength(1);
    expect(JSON.stringify(notifier.sent)).not.toContain(validContact.email);
    expect(JSON.stringify(notifier.sent)).not.toContain(validContact.message);
  });

  it("returns 422 with field messages on Zod validation failure, without calling Turnstile", async () => {
    const repo = inMemoryRepo();
    const turnstile = { verify: vi.fn(async () => true) };
    const res = await handleContactSubmission(
      jsonRequest("/api/forms/contato", { ...validContact, email: "invalido", consent: false }, { "Idempotency-Key": crypto.randomUUID() }),
      env,
      { turnstile, contact: () => ({ repo, notifier: null }) }
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { fields: Record<string, string> };
    expect(body.fields.email).toBe("E-mail inválido");
    expect(body.fields.consent).toBe("É necessário concordar com a Política de Privacidade.");
    expect(turnstile.verify).not.toHaveBeenCalled();
    expect(repo.createWithConsent).not.toHaveBeenCalled();
  });

  it("rejects unknown fields (strict contract)", async () => {
    const res = await handleContactSubmission(
      jsonRequest("/api/forms/contato", { ...validContact, isAdmin: true }, { "Idempotency-Key": crypto.randomUUID() }),
      env,
      { turnstile: passTurnstile, contact: () => ({ repo: inMemoryRepo(), notifier: null }) }
    );
    expect(res.status).toBe(422);
  });

  it("returns 403 when Turnstile fails and persists nothing", async () => {
    const repo = inMemoryRepo();
    const res = await handleContactSubmission(
      jsonRequest("/api/forms/contato", validContact, { "Idempotency-Key": crypto.randomUUID() }),
      env,
      { turnstile: failTurnstile, contact: () => ({ repo, notifier: null }) }
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("turnstile_failed");
    expect(repo.rows.size).toBe(0);
  });

  it("is idempotent: a retried submission returns the same reference code and notifies once", async () => {
    const repo = inMemoryRepo();
    const notifier = recordingNotifier();
    const key = crypto.randomUUID();
    const deps = { turnstile: passTurnstile, contact: () => ({ repo, notifier }) };

    const first = (await (await handleContactSubmission(jsonRequest("/api/forms/contato", validContact, { "Idempotency-Key": key }), env, deps)).json()) as { referenceCode: string };
    const second = (await (await handleContactSubmission(jsonRequest("/api/forms/contato", validContact, { "Idempotency-Key": key }), env, deps)).json()) as { referenceCode: string };

    expect(second.referenceCode).toBe(first.referenceCode);
    expect(repo.rows.size).toBe(1);
    expect(notifier.sent).toHaveLength(1);
  });

  it("returns a generic 500 without leaking driver errors when persistence fails", async () => {
    const repo = inMemoryRepo();
    repo.createWithConsent = vi.fn(async () => {
      throw new Error('duplicate key value violates unique constraint "contact_submissions_pkey" password=hunter2');
    });
    const res = await handleContactSubmission(
      jsonRequest("/api/forms/contato", validContact, { "Idempotency-Key": crypto.randomUUID() }),
      env,
      { turnstile: passTurnstile, contact: () => ({ repo, notifier: null }) }
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("constraint");
  });

  it("rejects cross-site origins with 403", async () => {
    const res = await handleContactSubmission(
      jsonRequest("/api/forms/contato", validContact, { "Idempotency-Key": crypto.randomUUID(), Origin: "https://evil.example" }),
      env,
      { turnstile: passTurnstile, contact: () => ({ repo: inMemoryRepo(), notifier: null }) }
    );
    expect(res.status).toBe(403);
  });
});
