export interface GuardOptions {
  maxBytes: number;
  accept: string[];
}

export function deny(status: number, headers?: Record<string, string>): Response {
  return new Response(null, {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

/**
 * Limite estrito em BYTES reais após codificação UTF-8 (§7.4).
 * Impede que caracteres acentuados ou emojis burlem a contagem de caracteres UTF-16.
 */
export function assertBodySize(raw: string, maxBytes: number): boolean {
  return new TextEncoder().encode(raw).byteLength <= maxBytes;
}

export function guardRequest(
  request: Request,
  publicSiteOrigin: string,
  opts: GuardOptions
): Response | null {
  if (request.method !== "POST") {
    return deny(405, { Allow: "POST" });
  }

  const contentType = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (!opts.accept.includes(contentType)) {
    return deny(415);
  }

  const origin = request.headers.get("Origin");
  if (origin && origin !== publicSiteOrigin) {
    return deny(403);
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && !["same-origin", "same-site"].includes(fetchSite)) {
    return deny(403);
  }

  return null;
}
