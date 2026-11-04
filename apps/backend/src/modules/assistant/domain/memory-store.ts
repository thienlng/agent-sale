import { MEMORY_STORE_PATTERN, type MemoryEntry } from './ports/assistant.repository.js';

/** Char limits per store (spec §10): who the owner is, how they run the shops, one business. */
export const OWNER_PROFILE_LIMIT = 1_400;
export const NOTES_LIMIT = 2_200;
export const BUSINESS_MEMORY_LIMIT = 1_000;

const BUSINESS_PREFIX = 'business:';

/** The business id of a `business:<uuid>` store, else null. */
export function businessOfStore(store: string): string | null {
  return store.startsWith(BUSINESS_PREFIX) ? store.slice(BUSINESS_PREFIX.length) : null;
}

export const businessStore = (businessId: string): string => `${BUSINESS_PREFIX}${businessId}`;

/**
 * True when the store name is valid and, for a business store, names one of `businessIds`
 * (the owner's businesses in the account).
 */
export function isKnownStore(store: string, businessIds: readonly string[]): boolean {
  if (!MEMORY_STORE_PATTERN.test(store)) return false;
  const business = businessOfStore(store);
  return business === null || businessIds.includes(business);
}

/** The char limit of a (valid) store. */
export function memoryLimit(store: string): number {
  if (store === 'owner_profile') return OWNER_PROFILE_LIMIT;
  if (store === 'notes') return NOTES_LIMIT;
  return BUSINESS_MEMORY_LIMIT;
}

/** Chars a store uses: the sum of its entries' text lengths. */
export function memoryUsed(entries: readonly Pick<MemoryEntry, 'text'>[]): number {
  return entries.reduce((sum, e) => sum + e.text.length, 0);
}

const STORE_RANK = (store: string): number =>
  store === 'owner_profile' ? 0 : store === 'notes' ? 1 : 2;

/** owner_profile, notes, then business stores by id (byte order); stable for prompt caching. */
export function compareStores(a: string, b: string): number {
  return STORE_RANK(a) - STORE_RANK(b) || (a < b ? -1 : a > b ? 1 : 0);
}
