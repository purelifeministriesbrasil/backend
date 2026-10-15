import { describe, expect, it, vi } from "vitest";
import { submitTriage } from "../src/application/usecases/submit-triage.js";
import { submitContact } from "../src/application/usecases/submit-contact.js";
import type { Notifier } from "../src/application/ports/notifier.js";
import { triageSubmissionSchema, contactSubmissionSchema } from "../src/schemas/index.js";
import { validContact, validTriage } from "./helpers.js";

const KEY = "3f1c2a9e-4b7d-4c1e-9a2b-8d7e6f5a4b3c";

/** Notificador cujo envio só termina quando o teste mandar: simula um Resend lento. */
function pendingNotifier() {
  let finish!: (sent: boolean) => void;
  const pending = new Promise<boolean>((resolve) => (finish = resolve));
  const notifier: Notifier = {
    notifyStaff: vi.fn(() => pending),
    sendToRecipient: vi.fn(async () => true),
  };
  return { notifier, finish };
}

describe("aviso à equipe depois da resposta", () => {
  it("triagem responde sem esperar o e-mail quando há defer", async () => {
    const { notifier, finish } = pendingNotifier();
    const deferred: Promise<unknown>[] = [];
    const uow = { createSubmissionWithConsent: vi.fn(async () => ({ referenceCode: "PLM-AAAA-BBBB", created: true })) };

    const result = await submitTriage(triageSubmissionSchema.parse(validTriage), KEY, {
      uow,
      notifier,
      defer: async (task) => {
        deferred.push(task);
      },
    });

    expect(result).toEqual({ ok: true, value: { referenceCode: "PLM-AAAA-BBBB" } });
    expect(notifier.notifyStaff).toHaveBeenCalledTimes(1);
    expect(deferred).toHaveLength(1);
    finish(true);
    await expect(deferred[0]).resolves.toBe(true);
  });

  it("contato responde sem esperar o e-mail quando há defer", async () => {
    const { notifier, finish } = pendingNotifier();
    const deferred: Promise<unknown>[] = [];
    const repo = { createWithConsent: vi.fn(async () => ({ referenceCode: "CTT-AAAA-BBBB", created: true })) };

    const result = await submitContact(contactSubmissionSchema.parse(validContact), KEY, {
      repo,
      notifier,
      defer: async (task) => {
        deferred.push(task);
      },
    });

    expect(result).toEqual({ ok: true, value: { referenceCode: "CTT-AAAA-BBBB" } });
    expect(deferred).toHaveLength(1);
    finish(false);
    await expect(deferred[0]).resolves.toBe(false);
  });

  it("retentativa idempotente (created=false) não agenda novo e-mail", async () => {
    const { notifier } = pendingNotifier();
    const defer = vi.fn(async () => undefined);
    const uow = { createSubmissionWithConsent: vi.fn(async () => ({ referenceCode: "PLM-AAAA-BBBB", created: false })) };

    await submitTriage(triageSubmissionSchema.parse(validTriage), KEY, { uow, notifier, defer });

    expect(notifier.notifyStaff).not.toHaveBeenCalled();
    expect(defer).not.toHaveBeenCalled();
  });
});
