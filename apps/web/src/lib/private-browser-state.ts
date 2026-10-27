/** Private browser caches share a namespace so logout also clears lazy features. */
export const PRIVATE_BROWSER_PREFIX = 'rapiz.private.';
export const PRIVATE_GENERATION_KEY = 'rapiz.private-generation';
let version = 0;
const listeners = new Set<(notify: boolean) => void>();
const invalidated = new Map<string, string | null>();

function storedGeneration(): string | null {
  try {
    return window.localStorage.getItem(PRIVATE_GENERATION_KEY);
  } catch {
    return null;
  }
}
let generation = storedGeneration() ?? 'initial';
let publishedGeneration = generation;

export function privateStateVersion(): number {
  return version;
}
export function privateCacheGeneration(): string {
  return generation;
}
export function isPrivateStateCurrent(expected: number): boolean {
  return (
    expected === version && (storedGeneration() ?? publishedGeneration) === publishedGeneration
  );
}
/** Retry a failed rotation once storage recovers; never claim a reload-safe write without it. */
export function publishPrivateCacheGeneration(): void {
  if ((storedGeneration() ?? publishedGeneration) !== publishedGeneration)
    throw new Error('Private session changed');
  if (
    generation !== publishedGeneration ||
    (storedGeneration() === null && generation !== 'initial')
  ) {
    window.localStorage.setItem(PRIVATE_GENERATION_KEY, generation);
    publishedGeneration = generation;
  }
}

export function privateKeyInvalidated(key: string, raw: string | null): boolean {
  return raw !== null && invalidated.get(key) === raw;
}
export function markPrivateKeyFresh(key: string): void {
  invalidated.delete(key);
}
export function onPrivateStateCleared(listener: (notify: boolean) => void): void {
  listeners.add(listener);
}

export function clearPrivateBrowserState(rotate = true): void {
  version++;
  generation = rotate ? crypto.randomUUID() : (storedGeneration() ?? generation);
  if (!rotate) {
    publishedGeneration = generation;
    // The initiating tab owns shared cleanup; a delayed remote event must not delete a newer session.
    listeners.forEach((listener) => listener(false));
    return;
  }
  try {
    publishPrivateCacheGeneration();
  } catch {
    // Quota exhaustion must not prevent the independent removal pass below.
  }
  try {
    const keys = Object.keys(window.localStorage).filter((key) =>
      key.startsWith(PRIVATE_BROWSER_PREFIX),
    );
    keys.forEach((key) => invalidated.set(key, window.localStorage.getItem(key)));
    for (const key of keys) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* The generation/tombstone also blocks restoration. */
      }
    }
  } catch {
    // In-memory invalidation still works when all browser storage is blocked.
  }
  listeners.forEach((listener) => listener(true));
}
