/**
 * Modelos de e-mail com a identidade visual do site (azul institucional, papel marfim, logotipo).
 * Funções puras: recebem dados já validados e devolvem `{ text, html }`. Todo texto dinâmico é escapado.
 * Layout em tabelas e estilos inline por compatibilidade com Gmail e Outlook; o logotipo é um PNG
 * publicado pelo site (`/email/logo-plm-branca.png`) porque WebP e SVG não são confiáveis em e-mail.
 */

export interface EmailContent {
  readonly text: string;
  readonly html: string;
}

interface Layout {
  readonly siteOrigin: string;
  readonly preheader: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly button?: { readonly label: string; readonly url: string };
  readonly note?: string;
  readonly footerLink?: { readonly label: string; readonly url: string };
}

const NAVY = "#044A82";
const INK = "#1C2530";
const SLATE = "#454A50";
const PAPER = "#F5F2EC";
const IVORY = "#C1BDA6";
const FONT = "Montserrat, 'Segoe UI', Arial, Helvetica, sans-serif";
const ADDRESS = "Rua 27, quadra 1, lote 05 — Setor Colonial Parque II, Padre Lúcio, Águas Lindas de Goiás — GO, CEP 72910-990";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml(l: Layout): string {
  const origin = escapeHtml(l.siteOrigin);
  const paragraphs = l.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:26px;color:${SLATE};">${escapeHtml(p)}</p>`
    )
    .join("");
  const button = l.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px 0;"><tr><td align="center" bgcolor="${NAVY}" style="border-radius:4px;"><a href="${escapeHtml(l.button.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-size:14px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#FFFFFF;text-decoration:none;">${escapeHtml(l.button.label)}</a></td></tr></table>` +
      `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:13px;line-height:20px;color:#727272;">Se o botão não funcionar, copie e cole este endereço no navegador:<br><a href="${escapeHtml(l.button.url)}" style="color:${NAVY};word-break:break-all;">${escapeHtml(l.button.url)}</a></p>`
    : "";
  const note = l.note
    ? `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:13px;line-height:20px;color:#727272;">${escapeHtml(l.note)}</p>`
    : "";
  const footerLink = l.footerLink
    ? `<p style="margin:12px 0 0 0;font-family:${FONT};font-size:12px;line-height:18px;"><a href="${escapeHtml(l.footerLink.url)}" style="color:${NAVY};">${escapeHtml(l.footerLink.label)}</a></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(l.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(l.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAPER}" style="background-color:${PAPER};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#FFFFFF;border-radius:6px;overflow:hidden;">
<tr><td align="center" bgcolor="${NAVY}" style="padding:28px 24px;background-color:${NAVY};"><a href="${origin}/" target="_blank" rel="noopener noreferrer"><img src="${origin}/email/logo-plm-branca.png" width="220" alt="Pure Life Ministries Brasil" style="display:block;border:0;outline:none;height:auto;max-width:220px;"></a></td></tr>
<tr><td style="height:4px;line-height:4px;font-size:0;background-color:${IVORY};">&nbsp;</td></tr>
<tr><td style="padding:36px 32px 12px 32px;">
<h1 style="margin:0 0 20px 0;font-family:${FONT};font-size:24px;line-height:32px;font-weight:700;color:${INK};">${escapeHtml(l.heading)}</h1>
${paragraphs}${button}${note}
</td></tr>
<tr><td style="padding:8px 32px 28px 32px;"><div style="border-top:1px solid #DEDEDE;padding-top:16px;">
<p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:#727272;">Pure Life Ministries Brasil — Liderando Cristãos à Pureza desde 1986<br>${escapeHtml(ADDRESS)}</p>
<p style="margin:8px 0 0 0;font-family:${FONT};font-size:12px;line-height:18px;"><a href="${origin}/" style="color:${NAVY};">${origin.replace(/^https?:\/\//, "")}</a></p>
${footerLink}
</div></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function renderText(l: Layout): string {
  const parts = [l.heading, "", ...l.paragraphs.flatMap((p) => [p, ""])];
  if (l.button) parts.push(`${l.button.label}: ${l.button.url}`, "");
  if (l.note) parts.push(l.note, "");
  if (l.footerLink) parts.push(`${l.footerLink.label}: ${l.footerLink.url}`, "");
  parts.push("—", "Pure Life Ministries Brasil — Liderando Cristãos à Pureza desde 1986", l.siteOrigin);
  return parts.join("\n");
}

function build(layout: Layout): EmailContent {
  return { text: renderText(layout), html: renderHtml(layout) };
}

export function newsletterConfirmationEmail(input: {
  siteOrigin: string;
  confirmUrl: string;
  unsubscribeUrl: string;
  ttlHours: number;
}): EmailContent {
  return build({
    siteOrigin: input.siteOrigin,
    preheader: "Confirme o seu e-mail para receber ensinamentos bíblicos e novidades do ministério.",
    heading: "Confirme a sua inscrição",
    paragraphs: [
      "Recebemos um pedido para inscrever este e-mail na newsletter da Pure Life Ministries Brasil.",
      "Para começar a receber ensinamentos bíblicos e atualizações do ministério, confirme a inscrição pelo botão abaixo.",
    ],
    button: { label: "Confirmar inscrição", url: input.confirmUrl },
    note: `O link expira em ${input.ttlHours} horas. Se você não fez este pedido, basta ignorar esta mensagem: nada será enviado.`,
    footerLink: { label: "Não quero receber mensagens", url: input.unsubscribeUrl },
  });
}

/** Aviso interno genérico: o texto vem do próprio use case, que já respeita a política de sigilo (sem dados pessoais). */
export function noticeEmail(input: { siteOrigin: string; heading: string; text: string }): EmailContent {
  const paragraphs = input.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return build({
    siteOrigin: input.siteOrigin,
    preheader: input.heading,
    heading: input.heading,
    paragraphs,
  });
}
