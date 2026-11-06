/*
 * Rapiz service worker (T-190): makes the dashboard installable and shows Web Push
 * notifications. It caches nothing and handles no fetches, so the app always loads fresh from
 * the network. A push carries {title, body, url, tag} (backend `WebPushChannel`); a click focuses
 * an open Rapiz window (navigating it to the link) or opens a new one.
 */
/* global self, URL */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Rapiz';
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/app';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url },
  };
  if (typeof data.tag === 'string' && data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/app', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        if ('navigate' in open) return open.navigate(url);
        return undefined;
      }
      return self.clients.openWindow(url);
    })(),
  );
});
