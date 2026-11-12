import { scrubObject } from "./scrubber.js";

type Level = "info" | "warn" | "error";

/**
 * Log estruturado (JSON em uma linha) para Workers Logs / Logpush.
 * Todo contexto passa pelo scrubber: PII e relatos nunca chegam à telemetria.
 */
export function log(level: Level, event: string, context: Record<string, unknown> = {}): void {
  const reserved = { level, event, ts: new Date().toISOString() };
  // Campos reservados vêm primeiro e não podem ser sobrescritos por chaves homônimas do contexto.
  const line = JSON.stringify(Object.assign({ ...reserved }, scrubObject(context), reserved));
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Extrai só nome/código do erro: mensagens de drivers podem conter SQL ou valores de parâmetros. */
export function errorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length <= 64) return code;
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string" && name !== "Error") return name;
  }
  return "unknown_error";
}
