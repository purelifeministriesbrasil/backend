import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  /** Encerra o socket TCP. Em Workers, chamar via `ctx.waitUntil(close())` ao fim da requisição. */
  close: () => Promise<void>;
}

/**
 * Cliente Drizzle por requisição sobre PostgreSQL gerenciado (Neon, via Hyperdrive na borda).
 * Workers não reaproveitam sockets entre requisições: o cliente nasce e morre com ela.
 *
 * Configuração compatível com Hyperdrive e com poolers em modo transaction (PgBouncer do Neon):
 * - max: 1 (uma conexão por isolate/requisição)
 * - prepare: false (obrigatório em pooler no modo transaction)
 * - connect_timeout / idle_timeout limitados para falhar rápido
 * - SSL segue a URL: `sslmode=require` no Neon; o Hyperdrive cuida do TLS até o banco.
 */
export function createDbClient(databaseUrl: string): DbHandle {
  const client = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}
