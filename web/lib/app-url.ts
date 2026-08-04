/**
 * Builds callback URLs from one explicit public base URL when configured.
 * OAuth providers compare callback URLs character-for-character, so using the
 * request host in one route and a dashboard URL in another causes hard to
 * diagnose sign-in and Gmail connection failures.
 */
export function appUrl(request: Request, path: string, override?: string) {
  const configuredBase = normaliseBaseUrl(override || process.env.APP_BASE_URL);
  return new URL(path, configuredBase || request.url).toString();
}

export function normaliseBaseUrl(value?: string) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
