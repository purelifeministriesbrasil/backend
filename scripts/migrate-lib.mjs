// scripts/migrate-lib.mjs — regras puras do runner de migrations (sem I/O), testadas em tests/migrate-lib.test.ts.
import { createHash } from "node:crypto";

/** Nome aceito para arquivos de migration: `NNNN_nome_em_minusculas.sql`. */
export const MIGRATION_NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

/** Chave do advisory lock de sessão que serializa execuções concorrentes do runner. */
export const MIGRATION_LOCK_KEY = 727_246_001;

const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const toLf = (text) => text.replace(/\r\n/g, "\n");

/** Checksum canônico: SHA-256 do conteúdo com fins de linha normalizados para LF (independe do SO/checkout). */
export function canonicalChecksum(content) {
  return sha256(toLf(content));
}

/**
 * Checksums aceitos para um arquivo já aplicado. O runner antigo gravava o hash dos bytes crus, que
 * dependia do checkout (LF no Linux/CI, CRLF no Windows com core.autocrlf). Os dois continuam válidos
 * para que registros existentes não sejam tratados como migrations editadas.
 */
export function acceptedChecksums(content) {
  const lf = toLf(content);
  return new Set([sha256(lf), sha256(lf.replace(/\n/g, "\r\n"))]);
}

/**
 * Decide o que aplicar. `files`: nomes presentes no diretório; `contents`: nome → conteúdo;
 * `applied`: nome → checksum registrado em schema_migrations.
 * Retorna `{ errors, pending, alreadyApplied }`; com qualquer erro nada deve ser aplicado.
 */
export function planMigrations({ files, contents, applied }) {
  const errors = [];
  const sqlFiles = files.filter((name) => name.toLowerCase().endsWith(".sql"));
  for (const name of sqlFiles) {
    if (!MIGRATION_NAME.test(name)) errors.push(`Nome de migration inválido: ${name} (esperado NNNN_nome.sql em minúsculas).`);
  }
  const valid = sqlFiles.filter((name) => MIGRATION_NAME.test(name)).sort();
  const onDisk = new Set(valid);

  for (const name of [...applied.keys()].sort()) {
    if (!onDisk.has(name)) errors.push(`Migration registrada sem arquivo correspondente: ${name}.`);
  }

  const pending = [];
  const alreadyApplied = [];
  for (const name of valid) {
    const recorded = applied.get(name);
    if (recorded === undefined) {
      pending.push(name);
      continue;
    }
    if (!acceptedChecksums(contents.get(name)).has(recorded)) {
      errors.push(`Migration ${name} já aplicada foi alterada (checksum divergente). Crie uma nova migration.`);
    }
    alreadyApplied.push(name);
  }

  const lastApplied = alreadyApplied.at(-1);
  if (lastApplied) {
    for (const name of pending) {
      if (name < lastApplied) errors.push(`Migration ${name} está pendente mas ordena antes de ${lastApplied}, já aplicada.`);
    }
  }

  return { errors, pending, alreadyApplied };
}
