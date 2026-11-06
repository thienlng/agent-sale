import { useSyncExternalStore } from 'react';

/**
 * Installable app (T-190): registers the service worker and keeps the browser's install prompt
 * (`beforeinstallprompt`, Chrome/Edge/Android) so the app can offer "Cài ứng dụng" itself.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Registers `/sw.js` once per page load; failures (private mode, old browser) are ignored. */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
}

/** Starts listening for the install prompt; call once at startup. */
export function initPwa(): void {
  if (typeof window === 'undefined') return;
  registerServiceWorker();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
}

/** Running as the installed app (home-screen icon), not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** iPhone/iPad Safari: no install prompt; the user adds the app from the Share menu. */
export function isIos(): boolean {
  return typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/** Whether the browser offered an install prompt this page load. */
export function useInstallPrompt(): { available: boolean; install: () => Promise<boolean> } {
  const available = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => deferred !== null,
    () => false,
  );
  return {
    available,
    install: async () => {
      const e = deferred;
      if (!e) return false;
      deferred = null;
      emit();
      await e.prompt();
      return (await e.userChoice).outcome === 'accepted';
    },
  };
}
