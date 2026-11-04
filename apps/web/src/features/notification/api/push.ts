import { PushConfig, PushSubscriptionResult } from '@agent-sales/contracts';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api-client';
import { isIos, isStandalone, registerServiceWorker } from '@/lib/pwa';
import { useWorkspaceId } from '@/lib/use-workspace';

import { notificationKeys } from './notifications';

/**
 * Web Push on this device (T-190): the service worker (`/sw.js`) shows the pushes the backend's
 * `WebPushChannel` sends. A subscription is registered per account through the current business;
 * once the browser granted permission it is re-registered quietly on every visit, so a renewed
 * endpoint or another account of the same user keeps receiving.
 */

export type PushState =
  /** No service worker / Push API (old browser, iOS Safari outside an installed app). */
  | 'unsupported'
  /** The server has no VAPID keys: device notifications are off for everyone. */
  | 'unconfigured'
  | 'denied'
  /** Supported and allowed, but this device is not subscribed (or permission not asked yet). */
  | 'off'
  | 'on';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** iOS shows pushes only to an app added to the home screen (iOS 16.4+). */
export function isIosBrowserTab(): boolean {
  return isIos() && !isStandalone();
}

/** Set when the user turned device notifications off here, so they are not turned back on. */
const OFF_KEY = 'rapiz.push.off';
const readOff = () => {
  try {
    return localStorage.getItem(OFF_KEY) === '1';
  } catch {
    return false;
  }
};
const writeOff = (off: boolean) => {
  try {
    if (off) localStorage.setItem(OFF_KEY, '1');
    else localStorage.removeItem(OFF_KEY);
  } catch {
    // Storage blocked: the choice lasts this page load only.
  }
};

function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64Url}${'='.repeat((4 - (base64Url.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Fired when this device's subscription changes, so every switch shows the same state. */
const CHANGED = 'rapiz:push-changed';
const changed = () => window.dispatchEvent(new Event(CHANGED));

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Subscribes this browser (or reuses its subscription) and registers it for the caller. */
export async function subscribeDevice(publicKey: string, workspaceId: string): Promise<void> {
  registerServiceWorker();
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('bad subscription');
  await api('/notifications/push/subscriptions', PushSubscriptionResult, {
    method: 'POST',
    body: {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent.slice(0, 200),
    },
    workspaceId,
  });
  changed();
}

/** Forgets this browser for the caller and drops the browser subscription. */
export async function unsubscribeDevice(workspaceId: string): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/notifications/push/subscriptions/remove', PushSubscriptionResult, {
    method: 'POST',
    body: { endpoint: sub.endpoint },
    workspaceId,
  }).catch(() => undefined);
  await sub.unsubscribe().catch(() => false);
  changed();
}

export function usePushConfig() {
  const ws = useWorkspaceId();
  return useQuery({
    queryKey: [...notificationKeys.all(ws), 'push'],
    queryFn: ({ signal }) =>
      api('/notifications/push', PushConfig, { workspaceId: ws, signal }).then((r) => r.publicKey),
    enabled: Boolean(ws) && pushSupported(),
    staleTime: Infinity,
  });
}

/** This device's push state, with actions to turn it on (asks permission) or off. */
export function usePushNotifications(): {
  state: PushState;
  busy: boolean;
  enable: () => Promise<boolean>;
  disable: () => Promise<void>;
} {
  const ws = useWorkspaceId();
  const config = usePushConfig();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | null>(
    pushSupported() ? Notification.permission : null,
  );

  useEffect(() => {
    if (!pushSupported()) return;
    let live = true;
    const refresh = () => {
      setPermission(Notification.permission);
      void currentSubscription()
        .then((s) => live && setSubscribed(s !== null))
        .catch(() => live && setSubscribed(false));
    };
    refresh();
    window.addEventListener(CHANGED, refresh);
    return () => {
      live = false;
      window.removeEventListener(CHANGED, refresh);
    };
  }, []);

  const enable = useCallback(async () => {
    const key = config.data;
    if (!key || !ws) return false;
    setBusy(true);
    try {
      const granted =
        Notification.permission === 'granted' ||
        (await Notification.requestPermission()) === 'granted';
      setPermission(Notification.permission);
      if (!granted) return false;
      writeOff(false);
      await subscribeDevice(key, ws);
      setSubscribed(true);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, [config.data, ws]);

  const disable = useCallback(async () => {
    if (!ws) return;
    setBusy(true);
    try {
      writeOff(true);
      await unsubscribeDevice(ws);
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  }, [ws]);

  let state: PushState;
  if (!pushSupported()) state = 'unsupported';
  else if (config.isSuccess && config.data === null) state = 'unconfigured';
  else if (permission === 'denied') state = 'denied';
  else if (permission === 'granted' && subscribed) state = 'on';
  else state = 'off';
  return { state, busy, enable, disable };
}

/**
 * Keeps this device registered for the current account once the user allowed notifications
 * (here or with the inbox's "Bật thông báo"), unless they turned device notifications off here.
 * Mounted once in the app shell; renders nothing.
 */
export function PushSync(): null {
  const ws = useWorkspaceId();
  const config = usePushConfig();
  const key = config.data;
  const [granted, setGranted] = useState(
    () => pushSupported() && Notification.permission === 'granted',
  );
  useEffect(() => {
    // The inbox button asks for permission elsewhere: follow the permission as it changes.
    if (!pushSupported() || !navigator.permissions?.query) return;
    let status: PermissionStatus | null = null;
    const update = () => setGranted(Notification.permission === 'granted');
    void navigator.permissions
      .query({ name: 'notifications' })
      .then((s) => {
        status = s;
        s.addEventListener('change', update);
      })
      .catch(() => undefined);
    return () => status?.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!key || !ws || !granted || readOff()) return;
    void subscribeDevice(key, ws).catch(() => undefined);
  }, [key, ws, granted]);
  return null;
}
