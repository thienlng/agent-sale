/**
 * Cloudflare Turnstile for a new visitor's first message or upload. Loaded only when the site
 * config names a site key (the platform turns it on with TURNSTILE_SITE_KEY/TURNSTILE_SECRET);
 * otherwise the widget never contacts Cloudflare.
 */

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TIMEOUT_MS = 30000;

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance?: 'always' | 'execute' | 'interaction-only';
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
    },
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi | null> | null = null;

function load(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => resolve(window.turnstile ?? null);
    s.onerror = () => {
      loading = null;
      resolve(null);
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * One fresh token (tokens are single-use). The challenge shows itself only when Cloudflare needs
 * the visitor to interact; null when it failed, timed out or could not load.
 */
export async function challengeToken(siteKey: string): Promise<string | null> {
  const api = await load();
  if (!api) return null;
  const host = document.createElement('div');
  host.setAttribute('data-rapiz-turnstile', '');
  host.style.cssText = 'position:fixed;bottom:96px;right:24px;z-index:2147483647;';
  document.body.appendChild(host);
  let id: string | null = null;
  try {
    return await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
      const done = (token: string | null): void => {
        clearTimeout(timer);
        resolve(token);
      };
      id = api.render(host, {
        sitekey: siteKey,
        appearance: 'interaction-only',
        callback: (token) => done(token),
        'error-callback': () => done(null),
        'expired-callback': () => done(null),
      });
    });
  } finally {
    if (id) api.remove(id);
    host.remove();
  }
}
