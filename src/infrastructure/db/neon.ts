import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

/**
 * Cria a instância do cliente Drizzle conectado ao Neon Postgres serverless.
 * Deve ser chamado apenas no contexto do Worker (não em módulos de domínio/aplicação).
 */
export function createNeonDb(databaseUrl: string) {
  const sql = neon(databaseUrl);
  return drizzle(sql);
}
