import { isNearDuplicate, normaliseMemoryText } from './memory-similarity.js';
import type { MemoryTombstone } from './ports/assistant.repository.js';

/** How long an owner-deleted memory entry blocks the same text from coming back (QA NB-4). */
export const MEMORY_TOMBSTONE_DAYS = 90;
/** At most this many tombstones per store; the oldest go first. */
export const MEMORY_TOMBSTONE_MAX = 50;

const DAY_MS = 86_400_000;

/** Tombstones younger than `MEMORY_TOMBSTONE_DAYS` at `now`. */
export function liveTombstones(
  list: readonly MemoryTombstone[] | undefined,
  now = new Date(),
): MemoryTombstone[] {
  const since = now.getTime() - MEMORY_TOMBSTONE_DAYS * DAY_MS;
  return (list ?? []).filter((t) => Date.parse(t.deletedAt) >= since);
}

/** The live list plus one tombstone for `text` (normalised; an equal one is refreshed). */
export function withTombstone(
  list: readonly MemoryTombstone[] | undefined,
  text: string,
  now = new Date(),
): MemoryTombstone[] {
  const norm = normaliseMemoryText(text);
  const kept = liveTombstones(list, now).filter((t) => t.norm !== norm);
  if (!norm) return kept;
  return [...kept, { norm, deletedAt: now.toISOString() }].slice(-MEMORY_TOMBSTONE_MAX);
}

/** The live list without the tombstones `text` matches (the owner asked to remember it again). */
export function withoutTombstone(
  list: readonly MemoryTombstone[] | undefined,
  text: string,
  now = new Date(),
): MemoryTombstone[] {
  return liveTombstones(list, now).filter((t) => !isNearDuplicate(t.norm, text));
}

/** True when `text` says what an owner-deleted entry said (same near-duplicate rule as saving). */
export function matchesTombstone(
  list: readonly MemoryTombstone[] | undefined,
  text: string,
  now = new Date(),
): boolean {
  return liveTombstones(list, now).some((t) => isNearDuplicate(t.norm, text));
}
