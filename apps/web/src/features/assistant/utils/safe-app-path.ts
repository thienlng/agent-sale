const MAX_DECODE_PASSES = 3;

function isAppPath(path: string): boolean {
  return /^\/app(\/|$)/.test(path) && !path.split('/').some((s) => s === '..' || s === '.');
}

/**
 * A navigation target from the assistant, accepted only when it stays inside the dashboard
 * (ruling R9, defence in depth on top of the contract). The path is decoded until stable
 * (double encoding such as `%252e%252e` cannot hide a dot segment), must hold no `%`, query,
 * hash, backslash or control character, is normalised by the URL parser and checked again.
 * Returns the normalised path to navigate to, or null.
 */
export function safeAppPath(to: string): string | null {
  let decoded = to;
  try {
    for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return null;
  }
  if (/[%?#\\]/.test(decoded) || [...decoded].some((c) => c.charCodeAt(0) < 0x20)) return null;
  if (decoded.includes('//') || !isAppPath(decoded)) return null;
  let normalised: string;
  try {
    const url = new URL(decoded, 'http://rapiz.invalid');
    if (url.origin !== 'http://rapiz.invalid' || url.search || url.hash) return null;
    normalised = url.pathname;
  } catch {
    return null;
  }
  return isAppPath(normalised) ? normalised : null;
}
