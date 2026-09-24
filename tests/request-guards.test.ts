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
    const req = new Request("https://purelifebrasil.org/api/forms/triagem", {
      method: "GET",
    });
    const res = guardRequest(req, "https://purelifebrasil.org", {
      maxBytes: 8192,
      accept: ["application/json"],
    });

    expect(res).not.toBeNull();
    expect(res?.status).toBe(405);
    expect(res?.headers.get("Allow")).toBe("POST");
  });

  it("blocks unacceptable Content-Type with 415", () => {
    const req = new Request("https://purelifebrasil.org/api/forms/triagem", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
    });
    const res = guardRequest(req, "https://purelifebrasil.org", {
      maxBytes: 8192,
      accept: ["application/json"],
    });

    expect(res).not.toBeNull();
    expect(res?.status).toBe(415);
  });

  it("blocks divergent Origin with 403", () => {
    const req = new Request("https://purelifebrasil.org/api/forms/triagem", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://malicious-site.com",
      },
    });
    const res = guardRequest(req, "https://purelifebrasil.org", {
      maxBytes: 8192,
      accept: ["application/json"],
    });

    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
  });

  it("allows legitimate same-origin requests", () => {
    const req = new Request("https://purelifebrasil.org/api/forms/triagem", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://purelifebrasil.org",
        "Sec-Fetch-Site": "same-origin",
      },
    });
    const res = guardRequest(req, "https://purelifebrasil.org", {
      maxBytes: 8192,
      accept: ["application/json"],
    });

    expect(res).toBeNull();
  });
});
