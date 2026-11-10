import { useEffect } from 'react';

/**
 * Tab icon by session: signed-out screens (login, signup, invite) keep the white tile from
 * index.html, like the marketing site; the signed-in shell switches to the charcoal tile.
 */
const SIGNED_OUT = { svg: '/favicon-light.svg', png: '/favicon-light.png' };
const SIGNED_IN = { svg: '/favicon.svg', png: '/favicon.png' };

function setFavicon(icons: { svg: string; png: string }): void {
  document
    .querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]')
    ?.setAttribute('href', icons.svg);
  document
    .querySelector<HTMLLinkElement>('link[rel="icon"][type="image/png"]')
    ?.setAttribute('href', icons.png);
}

/** Shows the signed-in tab icon while the calling layout is mounted. */
export function useSignedInFavicon(): void {
  useEffect(() => {
    setFavicon(SIGNED_IN);
    return () => setFavicon(SIGNED_OUT);
  }, []);
}
