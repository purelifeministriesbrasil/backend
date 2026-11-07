import { describe, it, expect, vi } from "vitest";
import { handleNewsletterConfirmation, handleNewsletterSubscription, handleNewsletterUnsubscribe } from "../src/presentation/forms/newsletter.js";
import type { NewsletterRepository } from "../src/application/ports/newsletter-repository.js";
import { randomToken, sha256Hex } from "../src/infrastructure/crypto/hashing.js";
import { SITE, failTurnstile, jsonRequest, passTurnstile, recordingNotifier } from "./helpers.js";

interface Row {
  status: string;
  tokenHash: string | null;
  unsubHash: string | null;
  unsubExpiresAt: number;
  sentAt: number;
}

function inMemoryRepo(): NewsletterRepository & { rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  return {
    rows,
    upsertPending: vi.fn(async ({ email, confirmTokenHash, unsubscribeTokenHash, unsubscribeExpiresAt, resendCooldownSeconds, now }) => {
      const row = rows.get(email);
      if (!row) {
        rows.set(email, {
          status: "pending",
          tokenHash: confirmTokenHash,
          unsubHash: unsubscribeTokenHash,
          unsubExpiresAt: unsubscribeExpiresAt.getTime(),
          sentAt: now.getTime(),
        });
        return { kind: "confirmation_required" as const };
      }
      if (row.status === "confirmed") return { kind: "no_action" as const };
      if (now.getTime() - row.sentAt < resendCooldownSeconds * 1000) return { kind: "no_action" as const };
      Object.assign(row, {
        status: "pending",
        tokenHash: confirmTokenHash,
        unsubHash: unsubscribeTokenHash,
        unsubExpiresAt: unsubscribeExpiresAt.getTime(),
        sentAt: now.getTime(),
      });
      return { kind: "confirmation_required" as const };
    }),
    confirm: vi.fn(async (hash) => {
      for (const row of rows.values()) {
        if (row.tokenHash === hash && row.status === "pending") {
          Object.assign(row, { status: "confirmed", tokenHash: null });
          return true;
        }
      }
      return false;
    }),
    unsubscribe: vi.fn(async (hash, now) => {
      for (const row of rows.values()) {
        if (
          row.unsubHash === hash &&
          ["pending", "confirmed"].includes(row.status) &&
          row.unsubExpiresAt > now.getTime()
        ) {
          Object.assign(row, { status: "unsubscribed", unsubHash: null, tokenHash: null });
          return true;
        }
      }
      return false;
    }),
  };
}

const env = { PUBLIC_SITE_ORIGIN: SITE };
const payload = { email: "Leitor@Example.com ", policyVersion: "2026-09-19", turnstileToken: "token-turnstile-valido" };

function setup(turnstile = passTurnstile) {
  const repo = inMemoryRepo();
  const notifier = recordingNotifier();
  const links: string[] = [];
  const unsubLinks: string[] = [];
  const deps = {
    turnstile,
    newsletter: () => ({
      repo,
      notifier,
      tokens: { generate: randomToken, hash: sha256Hex },
      confirmUrl: (token: string) => {
        const url = `${SITE}/newsletter/confirmar/#token=${token}`;
        links.push(url);
        return url;
      },
      unsubscribeUrl: (token: string) => {
        const url = `${SITE}/newsletter/cancelar/#token=${token}`;
        unsubLinks.push(url);
        return url;
      },
    }),
  };
  return { repo, notifier, links, unsubLinks, deps };
}

describe("POST /api/forms/newsletter", () => {
  it("subscribes (JSON), stores pending and sends a double opt-in link with the token in the URL fragment", async () => {
    const { repo, notifier, links, deps } = setup();
    const res = await handleNewsletterSubscription(
      jsonRequest("/api/forms/newsletter", payload, { Accept: "application/json" }),
      env,
      deps
    );

    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(repo.rows.get("leitor@example.com")?.status).toBe("pending");
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].to).toBe("leitor@example.com");
    expect(links[0]).toMatch(/\/newsletter\/confirmar\/#token=[A-Za-z0-9_-]{43}$/);
    // O token puro nunca é persistido: só o hash.
    const token = links[0].split("#token=")[1];
    expect(repo.rows.get("leitor@example.com")?.tokenHash).toBe(await sha256Hex(token));
  });

  it("is idempotent for duplicates: same neutral response, no second e-mail inside the cooldown", async () => {
    const { notifier, deps } = setup();
    const first = await handleNewsletterSubscription(jsonRequest("/api/forms/newsletter", payload, { Accept: "application/json" }), env, deps);
    const second = await handleNewsletterSubscription(jsonRequest("/api/forms/newsletter", payload, { Accept: "application/json" }), env, deps);

    expect(await first.text()).toBe(await second.text());
    expect(notifier.sent).toHaveLength(1);
  });

  it("answers neutrally to validation failures without persisting", async () => {
    const { repo, deps } = setup();
    const res = await handleNewsletterSubscription(
      jsonRequest("/api/forms/newsletter", { ...payload, email: "nao-e-email" }, { Accept: "application/json" }),
      env,
      deps
    );
    expect(res.status).toBe(200);
    expect(repo.upsertPending).not.toHaveBeenCalled();
  });

  it("silently drops honeypot submissions", async () => {
    const { repo, notifier, deps } = setup();
    const res = await handleNewsletterSubscription(
      jsonRequest("/api/forms/newsletter", { ...payload, website: "http://spam" }, { Accept: "application/json" }),
      env,
      deps
    );
    expect(res.status).toBe(200);
    expect(repo.upsertPending).not.toHaveBeenCalled();
    expect(notifier.sent).toHaveLength(0);
  });

  it("returns 403 to JS clients when a provided Turnstile token is invalid", async () => {
    const { repo, deps } = setup(failTurnstile);
    const res = await handleNewsletterSubscription(
      jsonRequest("/api/forms/newsletter", payload, { Accept: "application/json" }),
      env,
      deps
    );
    expect(res.status).toBe(403);
    expect(repo.upsertPending).not.toHaveBeenCalled();
  });

  it("supports the no-JS form fallback with an absolute 303 redirect to the site", async () => {
    const { repo, deps } = setup();
    const req = new Request("https://api.purelifeministriesbrasil.org/api/forms/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: SITE, "Sec-Fetch-Site": "same-site" },
      body: "email=leitor%40example.com&website=&policyVersion=2026-09-19",
    });
    const res = await handleNewsletterSubscription(req, env, deps);

    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe(`${SITE}/?inscricao=confirmar`);
    expect(repo.rows.size).toBe(1);
  });

  it("rejects HTTP parameter pollution in form posts", async () => {
    const { deps } = setup();
    const req = new Request("https://api.purelifeministriesbrasil.org/api/forms/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: SITE },
      body: "email=a%40example.com&email=b%40example.com&policyVersion=2026-09-19",
    });
    const res = await handleNewsletterSubscription(req, env, deps);
    expect(res.status).toBe(400);
  });

  it("confirms with a valid token once and rejects reuse", async () => {
    const { links, deps } = setup();
    await handleNewsletterSubscription(jsonRequest("/api/forms/newsletter", payload, { Accept: "application/json" }), env, deps);
    const token = links[0].split("#token=")[1];

    const confirmDeps = { newsletter: deps.newsletter };
    const ok = await handleNewsletterConfirmation(jsonRequest("/api/forms/newsletter/confirm", { token }), env, confirmDeps);
    expect(ok.status).toBe(200);

    const reused = await handleNewsletterConfirmation(jsonRequest("/api/forms/newsletter/confirm", { token }), env, confirmDeps);
    expect(reused.status).toBe(410);

    const malformed = await handleNewsletterConfirmation(jsonRequest("/api/forms/newsletter/confirm", { token: "x" }), env, confirmDeps);
    expect(malformed.status).toBe(400);
  });
});

describe("POST /api/forms/newsletter/unsubscribe", () => {
  const subscribe = async (ctx: ReturnType<typeof setup>) => {
    await handleNewsletterSubscription(jsonRequest("/api/forms/newsletter", payload, { Accept: "application/json" }), env, ctx.deps);
    return ctx.unsubLinks[0].split("#token=")[1];
  };
  const unsub = (ctx: ReturnType<typeof setup>, token: unknown) =>
    handleNewsletterUnsubscribe(jsonRequest("/api/forms/newsletter/unsubscribe", { token }), env, { newsletter: ctx.deps.newsletter });

  it("puts a one-time unsubscribe link in the e-mail and persists only its hash", async () => {
    const ctx = setup();
    const token = await subscribe(ctx);

    expect(ctx.unsubLinks[0]).toMatch(/\/newsletter\/cancelar\/#token=[A-Za-z0-9_-]{43}$/);
    expect(ctx.notifier.sent[0].text ?? JSON.stringify(ctx.notifier.sent[0])).toContain(`/newsletter/cancelar/#token=${token}`);
    expect(ctx.repo.rows.get("leitor@example.com")?.unsubHash).toBe(await sha256Hex(token));
    expect(token).not.toBe(ctx.links[0].split("#token=")[1]);
  });

  it("unsubscribes once and answers the same neutral 200 on reuse (idempotent)", async () => {
    const ctx = setup();
    const token = await subscribe(ctx);

    const first = await unsub(ctx, token);
    expect(first.status).toBe(200);
    expect(ctx.repo.rows.get("leitor@example.com")?.status).toBe("unsubscribed");
    expect(ctx.repo.rows.get("leitor@example.com")?.unsubHash).toBeNull();

    const second = await unsub(ctx, token);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(await first.clone().text());
  });

  it("gives the same neutral answer for unknown tokens and 400 for malformed ones", async () => {
    const ctx = setup();
    const known = await subscribe(ctx);
    const unknown = await unsub(ctx, randomToken());
    expect(unknown.status).toBe(200);
    expect(ctx.repo.rows.get("leitor@example.com")?.status).toBe("pending");
    expect(known).toBeTruthy();

    expect((await unsub(ctx, "x")).status).toBe(400);
    expect((await unsub(ctx, undefined)).status).toBe(400);
  });

  it("does not unsubscribe with an expired token", async () => {
    const ctx = setup();
    const token = await subscribe(ctx);
    ctx.repo.rows.get("leitor@example.com")!.unsubExpiresAt = Date.now() - 1000;

    expect((await unsub(ctx, token)).status).toBe(200);
    expect(ctx.repo.rows.get("leitor@example.com")?.status).toBe("pending");
  });

  it("never changes state on GET and requires an explicit POST", async () => {
    const ctx = setup();
    await subscribe(ctx);
    const res = await handleNewsletterUnsubscribe(
      new Request("https://api.purelifeministriesbrasil.org/api/forms/newsletter/unsubscribe", { method: "GET", headers: { Origin: SITE } }),
      env,
      { newsletter: ctx.deps.newsletter }
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(ctx.repo.unsubscribe).not.toHaveBeenCalled();
  });

  it("allows a new subscription after unsubscribing only through a fresh explicit opt-in", async () => {
    const ctx = setup();
    const token = await subscribe(ctx);
    await unsub(ctx, token);
    ctx.repo.rows.get("leitor@example.com")!.sentAt = 0; // fora do cooldown

    await handleNewsletterSubscription(jsonRequest("/api/forms/newsletter", payload, { Accept: "application/json" }), env, ctx.deps);
    const row = ctx.repo.rows.get("leitor@example.com")!;
    expect(row.status).toBe("pending"); // exige nova confirmação (double opt-in)
    expect(row.unsubHash).not.toBeNull();
    expect(ctx.notifier.sent).toHaveLength(2);
  });
});
