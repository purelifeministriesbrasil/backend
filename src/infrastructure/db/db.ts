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
 * Cliente Drizzle por requisição sobre PostgreSQL gerenciado (Supabase).
 * Workers não reaproveitam sockets entre requisições: o cliente nasce e morre com ela.
 *
 * Configuração para Supabase Supavisor em modo transaction (porta 6543):
 * - max: 1 (uma conexão por isolate/requisição)
 * - prepare: false (obrigatório em pooler no modo transaction)
 * - connect_timeout / idle_timeout limitados para falhar rápido
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
