/**
 * A navigation target from the assistant, accepted only when it stays inside the dashboard
 * (ruling R9, defence in depth on top of the contract): decoded, under `/app`, no `..` segment,
 * no query or hash, no scheme or protocol-relative tricks. Anything else returns null.
 */
export function safeAppPath(to: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(to);
  } catch {
    return null;
  }
  if (!/^\/app(\/|$)/.test(decoded)) return null;
  if (/[?#\\]/.test(decoded) || [...decoded].some((c) => c.charCodeAt(0) < 0x20)) return null;
  if (decoded.split('/').some((segment) => segment === '..' || segment === '.')) return null;
  if (decoded.includes('//')) return null;
  return decoded;
}
