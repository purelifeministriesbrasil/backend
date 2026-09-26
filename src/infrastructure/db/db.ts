import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

/**
 * Cria a instância do cliente Drizzle conectado ao PostgreSQL gerenciado (Supabase / Postgres).
 * Deve ser chamado apenas no contexto do Worker (não em módulos de domínio/aplicação).
 */
export function createDbClient(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzle(sql);
}

/**
 * Alias retrocompatível para inicialização do cliente de banco de dados.
 */
export const createNeonDb = createDbClient;
