import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

/**
 * Cria a instância do cliente Drizzle conectado ao PostgreSQL gerenciado (Supabase / Postgres).
 * Compatível com Cloudflare Workers via nodejs_compat (conexão TCP direta ou via pooler).
 *
 * Configurações para Cloudflare Workers + Supabase PgBouncer (porta 6543):
 * - max: 1 (isolamento por Worker isolate)
 * - idle_timeout: 20s
 * - connect_timeout: 10s
 * - prepare: false (essencial para PgBouncer no modo transaction)
 */
export function createDbClient(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  return drizzle(client, { schema });
}

/**
 * Alias retrocompatível para inicialização do cliente de banco de dados.
 */
export const createNeonDb = createDbClient;

