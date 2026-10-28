import { useSyncExternalStore } from 'react';

import { storage } from '../storage';
import {
  PREFERENCE_KEYS,
  PREFERENCES,
  type PreferenceKey,
  type PreferenceValues,
  storageKey,
} from './registry';

function read<K extends PreferenceKey>(key: K): PreferenceValues[K] {
  const def = PREFERENCES[key];
  const stored = storage.get(storageKey(key));
  return (
    (def.values as readonly string[]).includes(stored ?? '') ? stored : def.defaultValue
  ) as PreferenceValues[K];
}

let values = Object.fromEntries(PREFERENCE_KEYS.map((k) => [k, read(k)])) as PreferenceValues;
const listeners = new Set<() => void>();
const darkQuery =
  typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function applyThemeMode(mode: PreferenceValues['theme_mode']): void {
  const dark = mode === 'dark' || (mode === 'system' && Boolean(darkQuery?.matches));
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

function apply<K extends PreferenceKey>(key: K, value: PreferenceValues[K]): void {
  document.documentElement.setAttribute(PREFERENCES[key].attribute, value);
  if (key === 'theme_mode') applyThemeMode(value as PreferenceValues['theme_mode']);
}

/** Applies everything once at startup (the boot script already did; this keeps React in sync). */
export function initPreferences(): void {
  for (const key of PREFERENCE_KEYS) apply(key, values[key]);
  darkQuery?.addEventListener('change', () => {
    if (values.theme_mode === 'system') applyThemeMode('system');
  });
}

export function setPreference<K extends PreferenceKey>(key: K, value: PreferenceValues[K]): void {
  values = { ...values, [key]: value };
  storage.set(storageKey(key), value);
  apply(key, value);
  listeners.forEach((l) => l());
}

/** Restores defaults for `keys` (all preferences when omitted). */
export function resetPreferences(keys: readonly PreferenceKey[] = PREFERENCE_KEYS): void {
  for (const key of keys) {
    setPreference(key, PREFERENCES[key].defaultValue as PreferenceValues[typeof key]);
  }
}

export function usePreferences(): PreferenceValues {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => values,
  );
}
