import { describe, it, expect } from "vitest";
import { assertBodySize, guardRequest } from "../src/infrastructure/security/request-guards.js";

describe("Request Guards (§7.4)", () => {
  it("measures body size in UTF-8 bytes, not UTF-16 code units", () => {
    // String com acentos e caracteres especiais: em UTF-16 tem length menor do que em bytes
    const textWithAccents = "Águas Lindas de Goiás — Coração Rendido à Graça";
    const utf16Length = textWithAccents.length;
    const utf8ByteLength = new TextEncoder().encode(textWithAccents).byteLength;

    expect(utf8ByteLength).toBeGreaterThan(utf16Length);

    // Deve falhar se o limite for baseado apenas no comprimento UTF-16
    expect(assertBodySize(textWithAccents, utf16Length)).toBe(false);
    expect(assertBodySize(textWithAccents, utf8ByteLength)).toBe(true);
  });

  it("blocks non-POST methods with 405", () => {
    const req = new Request("https://purelifeministriesbrasil.org/api/forms/triagem", {
      method: "GET",
    });
    const res = guardRequest(req, "https://purelifeministriesbrasil.org", {
      maxBytes: 8192,
      accept: ["application/json"],
    });

    expect(res).not.toBeNull();
    expect(res?.status).toBe(405);
    expect(res?.headers.get("Allow")).toBe("POST");
  });

  it("blocks unacceptable Content-Type with 415", () => {
    const req = new Request("https://purelifeministriesbrasil.org/api/forms/triagem", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
    });
    const res = guardRequest(req, "https://purelifeministriesbrasil.org", {
      maxBytes: 8192,
      accept: ["application/json"],
    });

    expect(res).not.toBeNull();
    expect(res?.status).toBe(415);
  });

  it("blocks divergent Origin with 403", () => {
    const req = new Request("https://purelifeministriesbrasil.org/api/forms/triagem", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://malicious-site.com",
      },
    });
    const res = guardRequest(req, "https://purelifeministriesbrasil.org", {
      maxBytes: 8192,
      accept: ["application/json"],
    });

    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
  });

  it("allows legitimate same-origin requests", () => {
    const req = new Request("https://purelifeministriesbrasil.org/api/forms/triagem", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://purelifeministriesbrasil.org",
        "Sec-Fetch-Site": "same-origin",
      },
    });
    const res = guardRequest(req, "https://purelifeministriesbrasil.org", {
      maxBytes: 8192,
      accept: ["application/json"],
    });

    expect(res).toBeNull();
  });
});

describe("Request Guards: sinal de contexto de navegação (R5)", () => {
  const SITE_ORIGIN = "https://purelifeministriesbrasil.org";
  const opts = { maxBytes: 8192, accept: ["application/json", "application/x-www-form-urlencoded"] };
  const post = (headers: Record<string, string>) =>
    new Request("https://api.purelifeministriesbrasil.org/api/forms/contato", { method: "POST", headers });

  it("recusa (403) requisição sem Origin e sem Sec-Fetch-Site", () => {
    expect(guardRequest(post({ "Content-Type": "application/json" }), SITE_ORIGIN, opts)?.status).toBe(403);
  });

  it("aceita só com Origin válido (cliente sem Sec-Fetch-Site, ex.: Safari antigo)", () => {
    expect(guardRequest(post({ "Content-Type": "application/json", Origin: SITE_ORIGIN }), SITE_ORIGIN, opts)).toBeNull();
  });

  it("aceita só com Sec-Fetch-Site same-origin/same-site", () => {
    for (const site of ["same-origin", "same-site"]) {
      expect(guardRequest(post({ "Content-Type": "application/json", "Sec-Fetch-Site": site }), SITE_ORIGIN, opts)).toBeNull();
    }
  });

  it("aceita formulário nativo sem JavaScript (urlencoded com Origin do site)", () => {
    const req = post({ "Content-Type": "application/x-www-form-urlencoded", Origin: SITE_ORIGIN, "Sec-Fetch-Site": "same-site" });
    expect(guardRequest(req, SITE_ORIGIN, opts)).toBeNull();
  });

  it("recusa origem inválida e Sec-Fetch-Site cross-site/none, mesmo com o outro sinal válido", () => {
    expect(guardRequest(post({ "Content-Type": "application/json", Origin: "https://evil.example" }), SITE_ORIGIN, opts)?.status).toBe(403);
    expect(guardRequest(post({ "Content-Type": "application/json", Origin: "null" }), SITE_ORIGIN, opts)?.status).toBe(403);
    for (const site of ["cross-site", "none"]) {
      const req = post({ "Content-Type": "application/json", Origin: SITE_ORIGIN, "Sec-Fetch-Site": site });
      expect(guardRequest(req, SITE_ORIGIN, opts)?.status).toBe(403);
    }
  });
});
