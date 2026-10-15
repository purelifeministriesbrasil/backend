import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { handleHealth } from "./presentation/health.js";
import { handleTriageSubmission } from "./presentation/forms/triagem.js";
import { handleContactSubmission } from "./presentation/forms/contato.js";
import { handleNewsletterConfirmation, handleNewsletterSubscription } from "./presentation/forms/newsletter.js";
import { handleCreatePix } from "./presentation/donations/create-pix.js";
import { handlePaymentWebhook } from "./presentation/webhooks/payment.js";
import { handleScheduledPurge } from "./presentation/cron/purge.js";
import { serviceUnavailable, internalError, type TurnstileVerifier } from "./presentation/http.js";
import {
  ConfigError,
  isProduction,
  readCryptoConfig,
  readDatabaseUrl,
  readEmailConfig,
  readPaymentConfig,
  readTurnstileSecret,
  type Env,
} from "./infrastructure/config/env.js";
import { createAesGcmProvider } from "./infrastructure/crypto/aes-gcm.js";
import { createKeyedHasher, randomToken, sha256Hex, type KeyedHasher } from "./infrastructure/crypto/hashing.js";
import { createDbClient, type DbHandle } from "./infrastructure/db/db.js";
import { createTriageUnitOfWork } from "./infrastructure/db/unit-of-work.js";
import { createDrizzleContactRepository } from "./infrastructure/db/contact-repository.js";
import { createDrizzleNewsletterRepository } from "./infrastructure/db/newsletter-repository.js";
import { createDrizzleChargeRepository, createDrizzleDonationRepository } from "./infrastructure/db/donation-repository.js";
import { createIdempotencyRepository } from "./infrastructure/db/idempotency.js";
import { createDrizzlePurgeRepository } from "./infrastructure/db/purge-repository.js";
import { createResendNotifier } from "./infrastructure/email/resend.js";
import { createPaymentGateway } from "./infrastructure/payments/factory.js";
import { verifyTurnstileToken } from "./infrastructure/security/turnstile.js";
import { errorCode, log } from "./infrastructure/observability/logger.js";
import type { EncryptionProvider } from "./application/ports/encryption-provider.js";
import type { Notifier } from "./application/ports/notifier.js";

export type { Env } from "./infrastructure/config/env.js";

type VerifyTurnstileFn = (token: string, secret: string, ip?: string) => Promise<boolean>;

export interface AppOptions {
  /** Permite aos testes substituir a chamada à API siteverify. */
  verifyTurnstile?: VerifyTurnstileFn;
}

/** Serviços da requisição, criados sob demanda; o socket do banco é fechado ao final. */
class RequestServices {
  private dbHandle: DbHandle | null = null;
  private encryption: EncryptionProvider | null = null;
  private hasher: Promise<KeyedHasher> | null = null;

  constructor(
    private readonly env: Env,
    private readonly verifyTurnstile: VerifyTurnstileFn
  ) {}

  get db() {
    this.dbHandle ??= createDbClient(readDatabaseUrl(this.env));
    return this.dbHandle.db;
  }

  get enc(): EncryptionProvider {
    if (!this.encryption) {
      const config = readCryptoConfig(this.env);
      this.encryption = createAesGcmProvider(config.keys, config.currentVersion);
    }
    return this.encryption;
  }

  readonly hashEmail: KeyedHasher = async (value) => {
    this.hasher ??= createKeyedHasher(readCryptoConfig(this.env).hashPepper);
    return (await this.hasher)(value);
  };

  /** Notificações à equipe são opcionais: sem configuração de e-mail, apenas desativadas (com log). */
  get optionalNotifier(): Notifier | null {
    try {
      return createResendNotifier(readEmailConfig(this.env));
    } catch (err) {
      if (err instanceof ConfigError) {
        log("warn", "email.notifications_disabled", { invalidKeys: err.invalidKeys });
        return null;
      }
      throw err;
    }
  }

  get turnstile(): TurnstileVerifier {
    const secret = readTurnstileSecret(this.env);
    return { verify: (token, ip) => this.verifyTurnstile(token, secret, ip) };
  }

  /** Falha cedo (ConfigError → 503) se banco ou criptografia não estiverem configurados. */
  assertStorageConfigured(): void {
    readDatabaseUrl(this.env);
    readCryptoConfig(this.env);
  }

  async dispose(): Promise<void> {
    if (this.dbHandle) await this.dbHandle.close();
  }
}

type AppEnv = { Bindings: Env; Variables: { services: RequestServices } };

/** Registra trabalho pós-resposta; fora do runtime Workers (testes) aguarda inline. */
async function runAfterResponse(c: Context<AppEnv>, task: Promise<void>): Promise<void> {
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    await task;
  }
}

function allowedOrigin(env: Env, origin: string): string | null {
  if (origin === env.PUBLIC_SITE_ORIGIN) return origin;
  if (!isProduction(env) && /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}$/.test(origin)) return origin;
  return null;
}

export function createApp(options: AppOptions = {}) {
  const verifyTurnstile = options.verifyTurnstile ?? verifyTurnstileToken;
  const app = new Hono<AppEnv>();

  app.use("*", secureHeaders({ crossOriginResourcePolicy: "same-site" }));

  app.use("/api/*", async (c, next) => {
    const services = new RequestServices(c.env, verifyTurnstile);
    c.set("services", services);
    try {
      await next();
    } finally {
      await runAfterResponse(c, services.dispose().catch(() => undefined));
    }
  });

  app.use("/api/forms/*", (c, next) =>
    cors({
      origin: (origin) => allowedOrigin(c.env, origin),
      allowMethods: ["POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Accept", "Idempotency-Key"],
      maxAge: 86400,
    })(c, next)
  );
  app.use("/api/donations/*", (c, next) =>
    cors({
      origin: (origin) => allowedOrigin(c.env, origin),
      allowMethods: ["POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Accept", "Idempotency-Key"],
      maxAge: 86400,
    })(c, next)
  );

  app.get("/health", () => handleHealth());

  app.post("/api/forms/triagem", (c) => {
    const s = c.get("services");
    // Valida a configuração antes de consumir o token Turnstile (de uso único) do usuário.
    s.assertStorageConfigured();
    return handleTriageSubmission(c.req.raw, c.env, {
      turnstile: s.turnstile,
      triage: () => ({
        uow: createTriageUnitOfWork(s.db, s.enc),
        notifier: s.optionalNotifier,
        defer: (task) => runAfterResponse(c, task.then(() => undefined)),
      }),
    });
  });

  app.post("/api/forms/contato", (c) => {
    const s = c.get("services");
    s.assertStorageConfigured();
    return handleContactSubmission(c.req.raw, c.env, {
      turnstile: s.turnstile,
      contact: () => ({
        repo: createDrizzleContactRepository(s.db, s.enc),
        notifier: s.optionalNotifier,
        defer: (task) => runAfterResponse(c, task.then(() => undefined)),
      }),
    });
  });

  app.post("/api/forms/newsletter", (c) => {
    const s = c.get("services");
    const emailConfig = readEmailConfig(c.env); // confirmação por e-mail é obrigatória: sem ela, 503
    s.assertStorageConfigured();
    const origin = c.env.PUBLIC_SITE_ORIGIN;
    return handleNewsletterSubscription(c.req.raw, c.env, {
      turnstile: s.turnstile,
      newsletter: () => ({
        repo: createDrizzleNewsletterRepository(s.db, s.enc, s.hashEmail),
        notifier: createResendNotifier(emailConfig),
        tokens: { generate: randomToken, hash: sha256Hex },
        confirmUrl: (token) => `${origin}/newsletter/confirmar/#token=${token}`,
      }),
    });
  });

  app.post("/api/forms/newsletter/confirm", (c) => {
    const s = c.get("services");
    s.assertStorageConfigured();
    return handleNewsletterConfirmation(c.req.raw, c.env, {
      newsletter: () => ({
        repo: createDrizzleNewsletterRepository(s.db, s.enc, s.hashEmail),
        tokens: { generate: randomToken, hash: sha256Hex },
      }),
    });
  });

  app.post("/api/donations/create-pix", (c) => {
    const s = c.get("services");
    const gateway = createPaymentGateway(readPaymentConfig(c.env));
    s.assertStorageConfigured();
    return handleCreatePix(c.req.raw, c.env, {
      turnstile: s.turnstile,
      donations: () => ({ gateway, repo: createDrizzleDonationRepository(s.db, s.enc, s.hashEmail) }),
    });
  });

  app.post("/api/webhooks/payment", (c) => {
    const s = c.get("services");
    const gateway = createPaymentGateway(readPaymentConfig(c.env));
    return handlePaymentWebhook(c.req.raw, {
      gateway,
      idempotency: createIdempotencyRepository(s.db),
      chargeRepo: createDrizzleChargeRepository(s.db),
      clock: { now: () => new Date() },
    });
  });

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  app.onError((err) => {
    if (err instanceof ConfigError) {
      // Nomes das chaves ajudam a operação; valores nunca são registrados.
      log("error", "config.invalid", { feature: err.feature, invalidKeys: err.invalidKeys });
      return serviceUnavailable();
    }
    log("error", "request.unhandled_error", { code: errorCode(err) });
    return internalError();
  });

  return app;
}

export const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    let handle: DbHandle;
    try {
      handle = createDbClient(readDatabaseUrl(env));
    } catch (err) {
      log("error", "cron.purge_skipped", { reason: err instanceof ConfigError ? err.message : errorCode(err) });
      return;
    }
    const purgeRepo = createDrizzlePurgeRepository(handle.db);
    ctx.waitUntil(
      handleScheduledPurge(purgeRepo)
        .then(() => undefined)
        .catch((err) => log("error", "cron.purge_failed", { code: errorCode(err) }))
        .finally(() => handle.close())
    );
  },
};

