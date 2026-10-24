/**
 * The one validation of a Hermes bridge base URL, shared by the generate provider, the sign-in
 * client and the model lister. Accepts only a plain http(s) origin/path: no credentials, query or
 * fragment. Returns the URL without a trailing slash, or null when it is not acceptable.
 *
 * Host policy (loopback or private network) is deployment configuration, not enforced here: the
 * URL comes from the platform-admin LLM config and the bridge is also reachable by service name.
 */
export function parseBridgeBaseUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
