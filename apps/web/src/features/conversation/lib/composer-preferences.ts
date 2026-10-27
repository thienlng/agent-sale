import { useSyncExternalStore } from 'react';
import { storage } from '@/lib/storage';

const PREFIX = 'rapiz.inbox.enter.v1:';
const values = new Map<string, boolean>();
const listeners = new Set<() => void>();

/** A device-local personal preference, independent of workspace and other users. */
export function enterToSend(userId: string): boolean {
  if (!userId) return true;
  const known = values.get(userId);
  if (known !== undefined) return known;
  const value = storage.get(PREFIX + userId) !== 'false';
  values.set(userId, value);
  return value;
}

export function setEnterToSend(userId: string, value: boolean): void {
  if (!userId) return;
  values.set(userId, value);
  storage.set(PREFIX + userId, String(value));
  listeners.forEach((listener) => listener());
}

export function useEnterToSend(userId: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => enterToSend(userId),
  );
}
