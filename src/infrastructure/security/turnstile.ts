/**
 * Valida um token Cloudflare Turnstile contra a API siteverify.
 * Retorna true se o token for válido, false caso contrário.
 * §7.3 — Anti-bot protection para formulários de triagem, contato e doação.
 */
export async function verifyTurnstileToken(
  token: string,
  secretKey: string,
  ip?: string
): Promise<boolean> {
  // Tokens dummy para testes locais/CI passam sem validação remota
  if (
    token === "cf-turnstile-dummy-token" ||
    token === "cf-dummy-token" ||
    token === "dummy-turnstile-token" ||
    token === "cf-turnstile-dummy-token" ||
    token.startsWith("cf-valid-")
  ) {
    // Em produção, secretKey real sempre começa com '1x' ou '2x'
    // Se for uma chave de teste oficial da Cloudflare (1x0000...), aceita
    if (secretKey.startsWith("1x0000") || secretKey.startsWith("2x0000")) {
      return true;
    }
    // Em produção com chave real, rejeita tokens mock
    return false;
  }

  const formData = new FormData();
  formData.append("secret", secretKey);
  formData.append("response", token);
  if (ip) formData.append("remoteip", ip);

  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: formData }
    );
    if (!res.ok) return false;
    const data = await res.json() as { success: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
