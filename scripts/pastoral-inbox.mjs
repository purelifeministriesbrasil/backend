// scripts/pastoral-inbox.mjs — caixa pastoral via linha de comando (ponte até existir um painel dedicado).
// Os dados de triagem/contato são cifrados (AES-256-GCM + AAD): o Table Editor do Supabase mostra só ciphertext.
// Esta ferramenta decifra LOCALMENTE e registra cada leitura em audit_events (§6.3).
//
// Variáveis: DATABASE_URL, TRIAGE_KEY_V1 [, TRIAGE_KEY_V2 ...], OPERATOR (e-mail de quem lê).
// Uso:
//   node scripts/pastoral-inbox.mjs list
//   node scripts/pastoral-inbox.mjs show <CÓDIGO> --reason "motivo" [--include-report]
//   node scripts/pastoral-inbox.mjs set-status <CÓDIGO> <status>
// Execute apenas em máquina confiável; nunca redirecione a saída para arquivos compartilhados.
import postgres from "postgres";

const [command, ...args] = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

function fail(message) {
  console.error(`[pastoral-inbox] ${message}`);
  process.exit(1);
}

const { DATABASE_URL, OPERATOR } = process.env;
if (!DATABASE_URL) fail("DATABASE_URL não definido.");
if (!OPERATOR) fail("OPERATOR (identificação de quem acessa) é obrigatório para auditoria.");

const keys = new Map(
  Object.entries(process.env)
    .filter(([k, v]) => /^TRIAGE_KEY_V\d+$/.test(k) && v)
    .map(([k, v]) => [Number(k.slice("TRIAGE_KEY_V".length)), Buffer.from(v, "base64")])
);

async function decrypt(ciphertext, iv, keyVersion, entityType, entityId, field) {
  const raw = keys.get(keyVersion);
  if (!raw || raw.length !== 32) throw new Error(`Chave TRIAGE_KEY_V${keyVersion} ausente ou inválida.`);
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: Buffer.from(iv, "base64"),
      additionalData: new TextEncoder().encode(`${entityType}:${entityId}:${field}:v${keyVersion}`),
      tagLength: 128,
    },
    key,
    Buffer.from(ciphertext, "base64")
  );
  return new TextDecoder().decode(plain);
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

async function audit(action, entityType, entityId, reason) {
  await sql`INSERT INTO audit_events (actor, actor_role, action, reason, entity_type, entity_id)
            VALUES (${OPERATOR}, 'pastoral', ${action}, ${reason ?? null}, ${entityType}, ${entityId})`;
}

async function findByCode(code) {
  const [triage] = await sql`SELECT * FROM triage_submissions WHERE reference_code = ${code}`;
  if (triage) return { kind: "triage", row: triage };
  const [contact] = await sql`SELECT * FROM contact_submissions WHERE reference_code = ${code}`;
  if (contact) return { kind: "contact", row: contact };
  return null;
}

try {
  if (command === "list") {
    const triage = await sql`SELECT reference_code, program_interest, contact_channel, status, created_at
                             FROM triage_submissions WHERE status NOT IN ('closed','purged') ORDER BY created_at`;
    const contacts = await sql`SELECT reference_code, subject, status, created_at
                               FROM contact_submissions WHERE status NOT IN ('closed','purged') ORDER BY created_at`;
    console.log("Triagens abertas:");
    console.table(triage);
    console.log("Contatos abertos:");
    console.table(contacts);
    await audit("inbox.list", "inbox", null, null);
  } else if (command === "show") {
    const code = args[0];
    const reason = flag("--reason");
    if (!code || !reason || reason.trim().length < 5) fail('Informe o código e --reason "motivo do acesso" (mín. 5 caracteres).');
    const found = await findByCode(code);
    if (!found) fail("Código não encontrado (ou já expurgado).");

    const { row } = found;
    if (found.kind === "triage") {
      const contact = await decrypt(row.contact_ciphertext, row.contact_iv, row.key_version, "triage_submission", row.id, "contact");
      await audit("triage.contact_read", "triage_submission", row.id, reason);
      console.log({ codigo: code, programa: row.program_interest, canal: row.contact_channel, status: row.status, contato: JSON.parse(contact) });
      if (args.includes("--include-report") && row.report_ciphertext) {
        const report = await decrypt(row.report_ciphertext, row.report_iv, row.key_version, "triage_submission", row.id, "report");
        await audit("triage.report_read", "triage_submission", row.id, reason);
        console.log("Relato:\n" + report);
      }
    } else {
      const contact = await decrypt(row.contact_ciphertext, row.contact_iv, row.key_version, "contact_submission", row.id, "contact");
      const message = await decrypt(row.message_ciphertext, row.message_iv, row.key_version, "contact_submission", row.id, "message");
      await audit("contact.read", "contact_submission", row.id, reason);
      console.log({ codigo: code, assunto: row.subject, status: row.status, contato: JSON.parse(contact) });
      console.log("Mensagem:\n" + message);
    }
  } else if (command === "set-status") {
    const [code, status] = args;
    const found = code && (await findByCode(code));
    if (!found) fail("Código não encontrado.");
    const table = sql(found.kind === "triage" ? "triage_submissions" : "contact_submissions");
    await sql`UPDATE ${table} SET status = ${status} WHERE id = ${found.row.id}`;
    await audit(`${found.kind}.status_changed`, found.kind === "triage" ? "triage_submission" : "contact_submission", found.row.id, status);
    console.log(`Status de ${code} → ${status}`);
  } else {
    fail("Comandos: list | show <código> --reason \"...\" [--include-report] | set-status <código> <status>");
  }
} catch (err) {
  console.error(`[pastoral-inbox] Falha: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
