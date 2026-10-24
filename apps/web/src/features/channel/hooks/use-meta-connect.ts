import { useEffect, useRef, useState } from 'react';
import type { MetaProvider } from '@agent-sales/contracts';
import { startConnection } from '../api/channels';
export function allowedAuthorizationUrl(value: string, provider: MetaProvider): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      u.port === '' &&
      u.username === '' &&
      u.password === '' &&
      (provider === 'instagram'
        ? u.hostname === 'www.instagram.com' && u.pathname === '/oauth/authorize'
        : u.hostname === 'www.facebook.com' && /^\/v\d+\.\d+\/dialog\/oauth$/.test(u.pathname))
    );
  } catch {
    return false;
  }
}
export function useMetaConnect(onComplete: (id: string) => void) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  useEffect(() => () => cleanup.current?.(), []);
  const cancel = () => {
    cleanup.current?.();
    setPending(false);
  };
  function connect(provider: MetaProvider) {
    cleanup.current?.();
    setError(null);
    // Open in the user gesture before awaiting the API; Instagram may sever window.opener.
    const popup = window.open('about:blank', '_blank', 'popup,width=640,height=760');
    if (!popup) {
      setError('popupBlocked');
      return;
    }
    setPending(true);
    let expected = '';
    let disposed = false;
    const channel =
      typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('razpi-meta-oauth');
    const finish = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const m = value as Record<string, unknown>;
      if (m['type'] !== 'razpi:oauth:complete' || !expected || m['state'] !== expected) return;
      if (typeof m['discoveryId'] === 'string' && /^[a-f0-9-]{36}$/.test(m['discoveryId'])) {
        const id = m['discoveryId'];
        cleanup.current?.();
        setPending(false);
        complete.current(id);
      } else {
        cleanup.current?.();
        setPending(false);
        setError('connectionError');
      }
    };
    const listener = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.source === popup) finish(event.data);
    };
    window.addEventListener('message', listener);
    if (channel) channel.onmessage = (e) => finish(e.data);
    const timeout = window.setTimeout(() => {
      cleanup.current?.();
      setPending(false);
      setError('authorizationTimeout');
    }, 600000);
    cleanup.current = () => {
      disposed = true;
      clearTimeout(timeout);
      window.removeEventListener('message', listener);
      channel?.close();
      try {
        popup.close();
      } catch {
        /* Provider COOP may isolate its window. */
      }
      cleanup.current = null;
    };
    void startConnection(provider)
      .then((result) => {
        if (disposed) return;
        if (!allowedAuthorizationUrl(result.url, provider))
          throw new Error('Invalid authorization URL');
        expected = result.state;
        popup.location.href = result.url;
      })
      .catch(() => {
        if (disposed) return;
        cleanup.current?.();
        setPending(false);
        setError('connectionError');
      });
  }
  return { connect, cancel, pending, error };
}
