import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { customerDisplayName } from '../lib/inbox-list';
import { freshLeads } from '../lib/lead-alerts';
import type { InboxConversation } from '../lib/inbox-v2-types';

/** A short two-tone beep; silent where audio is blocked (autoplay rules) or missing. */
function beep(): void {
  try {
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const audio = new Context();
    const gain = audio.createGain();
    gain.gain.value = 0.08;
    gain.connect(audio.destination);
    [880, 1175].forEach((frequency, index) => {
      const tone = audio.createOscillator();
      tone.frequency.value = frequency;
      tone.connect(gain);
      tone.start(audio.currentTime + index * 0.14);
      tone.stop(audio.currentTime + index * 0.14 + 0.12);
    });
    window.setTimeout(() => void audio.close().catch(() => undefined), 600);
  } catch {
    // Sound is a nicety; never let it break the inbox.
  }
}

export const notificationsSupported = (): boolean =>
  typeof window !== 'undefined' && 'Notification' in window;

/**
 * Plays a sound and shows a browser notification when a refetch of the inbox brings a lead this tab
 * has not announced yet. In-app only: it works while the dashboard is open (no Web Push).
 */
export function useLeadAlerts(
  items: readonly InboxConversation[] | undefined,
  /** Identifies the list query; a different one has other rows, so the first load of it only primes. */
  queryKey = '',
): void {
  const { t } = useTranslation();
  const known = useRef(new Set<string>());
  const primed = useRef(false);
  const lastKey = useRef(queryKey);
  useEffect(() => {
    if (lastKey.current !== queryKey) {
      lastKey.current = queryKey;
      known.current.clear();
      primed.current = false;
    }
    if (!items) return;
    const fresh = freshLeads(items, known.current, primed.current);
    primed.current = true;
    if (!fresh.length) return;
    beep();
    if (!notificationsSupported() || Notification.permission !== 'granted') return;
    for (const c of fresh.slice(0, 3)) {
      try {
        const name = customerDisplayName(c, (provider, last4) =>
          t('channelInbox.v2.row.guest', { provider, last4 }),
        );
        new Notification(t('channelInbox.v2.notifications.leadTitle'), {
          body: t('channelInbox.v2.notifications.leadBody', { name, phone: c.lead?.phone ?? '' }),
          tag: `lead:${c.id}`,
        });
      } catch {
        // Some browsers only allow notifications from a service worker.
      }
    }
  }, [items, queryKey, t]);
}

/** Current permission, refreshed after a request; `null` when the browser has no Notification API. */
export function useNotificationPermission(): {
  permission: NotificationPermission | null;
  request: () => void;
} {
  const [permission, setPermission] = useState<NotificationPermission | null>(
    notificationsSupported() ? Notification.permission : null,
  );
  return {
    permission,
    request: () => {
      if (!notificationsSupported()) return;
      void Promise.resolve(Notification.requestPermission())
        .then(setPermission)
        .catch(() => undefined);
    },
  };
}
