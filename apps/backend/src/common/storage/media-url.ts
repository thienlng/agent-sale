import { isMediaPath } from '@agent-sales/contracts';

/**
 * Stored pictures (docs/lodging.md "Pictures"): Rapiz objects are kept
 * as host-relative `/media/<key>` paths. Older rows hold absolute URLs on whatever public host was
 * configured at upload time (often a dev tunnel that no longer exists), so every reader goes
 * through these helpers instead of trusting the stored host.
 */

/** The `/media/<key>` path of a Rapiz object, whatever host the URL names; null otherwise. */
export function mediaPath(url: string): string | null {
  const value = url.trim();
  // URL parsing would resolve `..` and decode escapes, so refuse them on the raw string.
  if (/\.\.|%|\\/.test(value)) return null;
  if (value.startsWith('/')) return isMediaPath(value) ? value : null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.search || parsed.hash) return null;
  return isMediaPath(parsed.pathname) ? parsed.pathname : null;
}

/** For web DTOs and storage: Rapiz objects become their path, external links stay as they are. */
export function toMediaPath(url: string): string {
  return mediaPath(url) ?? url;
}

/**
 * For channel sends (Messenger, Zalo, website widget): a Rapiz object on the CURRENT public base
 * (`S3_PUBLIC_URL`, e.g. `https://<host>/media`). External links and media without a configured
 * base are returned unchanged.
 */
export function absoluteMediaUrl(pathOrUrl: string, publicBase: string | undefined): string {
  const path = mediaPath(pathOrUrl);
  if (!path || !publicBase) return pathOrUrl;
  const origin = publicBase.replace(/\/+$/, '').replace(/\/media$/, '');
  return `${origin}${path}`;
}
