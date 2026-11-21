import { describe, expect, it } from "vitest";
import { newsletterConfirmationEmail, noticeEmail, escapeHtml } from "../src/application/emails/templates.js";

const ORIGIN = "https://purelifeministriesbrasil.org";

describe("e-mails com identidade visual", () => {
  it("confirmação: HTML com logotipo, botão, link de descadastro e versão em texto", () => {
    const mail = newsletterConfirmationEmail({
      siteOrigin: ORIGIN,
      confirmUrl: `${ORIGIN}/newsletter/confirmar/#token=abc`,
      unsubscribeUrl: `${ORIGIN}/newsletter/cancelar/#token=xyz`,
      ttlHours: 48,
    });
    expect(mail.html).toContain(`${ORIGIN}/email/logo-plm-branca.png`);
    expect(mail.html).toContain('alt="Pure Life Ministries Brasil"');
    expect(mail.html).toContain(`href="${ORIGIN}/newsletter/confirmar/#token=abc"`);
    expect(mail.html).toContain(`href="${ORIGIN}/newsletter/cancelar/#token=xyz"`);
    expect(mail.html).toContain("#044A82");
    expect(mail.html).toContain("48 horas");
    expect(mail.text).toContain(`${ORIGIN}/newsletter/confirmar/#token=abc`);
    expect(mail.text).toContain(`${ORIGIN}/newsletter/cancelar/#token=xyz`);
  });

  it("escapa conteúdo dinâmico (sem injeção de HTML)", () => {
    expect(escapeHtml(`<script>"a"&'b'</script>`)).toBe("&lt;script&gt;&quot;a&quot;&amp;&#39;b&#39;&lt;/script&gt;");
    const mail = noticeEmail({ siteOrigin: ORIGIN, heading: "<b>x</b>", text: "linha <i>1</i>\nlinha 2" });
    expect(mail.html).not.toContain("<b>x</b>");
    expect(mail.html).not.toContain("<i>1</i>");
    expect(mail.html).toContain("linha 2");
  });

  it("aviso à equipe: um parágrafo por linha e sem linhas vazias", () => {
    const mail = noticeEmail({ siteOrigin: ORIGIN, heading: "Nova mensagem", text: "A\n\nB\n" });
    expect(mail.html.match(/<p style="margin:0 0 16px 0/g)).toHaveLength(2);
  });
});
