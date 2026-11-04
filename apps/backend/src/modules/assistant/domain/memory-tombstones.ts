import {
  isLikelyDuplicate,
  isNearDuplicate,
  memoryContainment,
  memorySimilarity,
  normaliseMemoryText,
} from './memory-similarity.js';
import type { MemoryTombstone } from './ports/assistant.repository.js';

/** How long an owner-deleted memory entry blocks the same text from coming back (QA NB-4). */
export const MEMORY_TOMBSTONE_DAYS = 90;
/** At most this many tombstones per store; the oldest go first. */
export const MEMORY_TOMBSTONE_MAX = 50;

const DAY_MS = 86_400_000;
/** A text whose content words are at least this much inside a tombstone says its fact (QA5 #2). */
export const TOMBSTONE_CONTAINMENT = 0.5;
/** A tombstone is stricter than saving: this Jaccard already counts as the same fact (QA5 #2). */
export const TOMBSTONE_JACCARD = 0.35;

/**
 * `text` says what the tombstoned entry said, even reworded or split into pieces: a near
 * duplicate, or ≥ 50 % of its content words inside the tombstone, or a Jaccard ≥ 0.35.
 */
function saysTombstone(t: MemoryTombstone, text: string): boolean {
  return (
    isNearDuplicate(t.norm, text) ||
    isLikelyDuplicate(t.norm, text) ||
    memoryContainment(text, t.norm) >= TOMBSTONE_CONTAINMENT ||
    memorySimilarity(t.norm, text) >= TOMBSTONE_JACCARD
  );
}

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
  return liveTombstones(list, now).filter((t) => !saysTombstone(t, text));
}

/** True when `text` says what an owner-deleted entry said, reworded or split (`saysTombstone`). */
export function matchesTombstone(
  list: readonly MemoryTombstone[] | undefined,
  text: string,
  now = new Date(),
): boolean {
  return liveTombstones(list, now).some((t) => saysTombstone(t, text));
}
