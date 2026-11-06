/**
 * Video links in a lodging gallery: YouTube and Google Drive links play in the large view and
 * show a thumbnail (YouTube) or a Drive placeholder in the grid. Everything else stays a link.
 */
export type VideoLink =
  | { provider: 'youtube'; id: string; thumbnail: string; embed: string }
  | { provider: 'drive'; id: string; embed: string };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
/** Path prefixes whose next segment is the video id: /shorts/<id>, /embed/<id>… */
const YOUTUBE_ID_PATHS = new Set(['shorts', 'embed', 'live', 'v']);

function youtubeIdOf(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be' || host === 'www.youtu.be') return segments[0] ?? null;
  if (!YOUTUBE_HOSTS.has(host)) return null;
  if (segments[0] === 'watch') return url.searchParams.get('v');
  if (segments[0] && YOUTUBE_ID_PATHS.has(segments[0])) return segments[1] ?? null;
  return null;
}

function driveIdOf(url: URL): string | null {
  if (url.hostname.toLowerCase() !== 'drive.google.com') return null;
  const segments = url.pathname.split('/').filter(Boolean);
  // /file/d/<id>/view, also under a Workspace account: /a/<domain>/file/d/<id>/…
  const file = segments.indexOf('file');
  if (file >= 0 && segments[file + 1] === 'd') return segments[file + 2] ?? null;
  if (segments[0] === 'open' || segments[0] === 'uc') return url.searchParams.get('id');
  return null;
}

/** The player for a YouTube or Google Drive video link, or null for any other link. */
export function videoLinkOf(raw: string): VideoLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const youtube = youtubeIdOf(url);
  if (youtube !== null && YOUTUBE_ID.test(youtube))
    return {
      provider: 'youtube',
      id: youtube,
      thumbnail: `https://i.ytimg.com/vi/${youtube}/hqdefault.jpg`,
      embed: `https://www.youtube-nocookie.com/embed/${youtube}`,
    };
  const drive = driveIdOf(url);
  if (drive !== null && DRIVE_ID.test(drive))
    return {
      provider: 'drive',
      id: drive,
      embed: `https://drive.google.com/file/d/${drive}/preview`,
    };
  return null;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * What the owner pasted, as the https link to store: `youtu.be/x` and `www.youtube.com/…` get
 * `https://`, `http://` is upgraded. Null when it is not a public web address (plain words, a
 * host without a dot, `javascript:`, `ftp:`…).
 */
export function normalizeLinkInput(input: string): string | null {
  const value = input.trim();
  if (!value || /\s/.test(value)) return null;
  let candidate = value;
  if (/^http:\/\//i.test(value)) candidate = `https://${value.slice('http://'.length)}`;
  else if (value.startsWith('//')) candidate = `https:${value}`;
  else if (!SCHEME.test(value) || /^[^/:]+\.[^/:]+:\d+/.test(value)) candidate = `https://${value}`;
  try {
    const url = new URL(candidate);
    // A host without a dot ("hello", "https://abc") is a typo, not a public link.
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) return null;
  } catch {
    return null;
  }
  return candidate;
}
