import { describe, it, expect, vi, afterEach } from "vitest";
import { scrubObject } from "../src/infrastructure/observability/scrubber.js";
import { createResendNotifier } from "../src/infrastructure/email/resend.js";
import { submitTriage } from "../src/application/usecases/submit-triage.js";
import { log } from "../src/infrastructure/observability/logger.js";
import { validTriage } from "./helpers.js";

describe("AppSec Zero-Leakage Canary Sentinel Test (§5.1, US-5.5)", () => {
  const CANARY = "__CANARY_SENSITIVE__";

  afterEach(() => vi.unstubAllGlobals());

  it("scrubber redacts sensitive confession content and PII from observability data", () => {
    const scrubbed = scrubObject({
      fullName: "João Silva",
      email: "joao.silva@exemplo.com",
      donorEmail: "doador@exemplo.com",
      phone: "+55 61 99999-8888",
      report: `Relato pastoral íntimo: ${CANARY}`,
      message: `Outro detalhe confidencial: ${CANARY}`,
      turnstileToken: CANARY,
      webhookSecret: CANARY,
    });

    const scrubbedJson = JSON.stringify(scrubbed);
    expect(scrubbedJson).not.toContain(CANARY);
    expect(scrubbedJson).not.toContain("joao.silva@exemplo.com");
    expect(scrubbedJson).not.toContain("doador@exemplo.com");
    expect(scrubbedJson).not.toContain("+55 61 99999-8888");
  });

  it("staff notification for a triage NEVER transmits the report, name, e-mail or phone", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        requests.push(String(init.body));
        return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
      })
    );

    const notifier = createResendNotifier({
      apiKey: "re_test",
      from: "Pure Life <nao-responda@purelifebrasil.org>",
      staffRecipient: "equipe@purelifebrasil.org",
    });

    const result = await submitTriage(
      { ...validTriage, report: `Relato ${CANARY}`, fullName: `Nome ${CANARY}` } as never,
      crypto.randomUUID(),
      {
        uow: { createSubmissionWithConsent: async (i) => ({ submissionId: "id-1", referenceCode: i.referenceCode, created: true }) },
        notifier,
      }
    );

    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    const sent = requests[0];
    expect(sent).not.toContain(CANARY);
    expect(sent).not.toContain(validTriage.email);
    expect(sent).not.toContain("99999");
    expect(sent).toMatch(/PLM-[0-9A-Z]{4}-[0-9A-Z]{4}/);
  });

  it("structured logger never emits unscrubbed canary data", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((line: string) => void lines.push(line));
    log("error", "test.event", { report: CANARY, nested: { email: CANARY }, requestId: "req-1" });
    spy.mockRestore();

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(CANARY);
    expect(lines[0]).toContain("req-1");
  });
});
