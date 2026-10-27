import { type SendInboxMessageRequest } from '@agent-sales/contracts';
import { z } from 'zod';
import {
  PRIVATE_BROWSER_PREFIX,
  markPrivateKeyFresh,
  privateCacheGeneration,
  publishPrivateCacheGeneration,
  privateKeyInvalidated,
} from '@/lib/private-browser-state';

export const DRAFT_STORAGE_PREFIX = `${PRIVATE_BROWSER_PREFIX}inbox.draft.v1:`;
const MAX_AGE = 7 * 86400000;
const LIMIT = 100;
const TextAttempt = z.object({
  text: z.string().trim().min(1).max(2000),
  idempotencyKey: z.uuid(),
});
const Record = z.object({
  version: z.literal(1),
  generation: z.string(),
  savedAt: z.number().finite(),
  requestKey: z.uuid(),
  text: z.string().max(2000),
  attempt: TextAttempt.nullable(),
  failedAttempt: z.boolean().optional(),
});
interface TextDraft {
  text: string;
  attempt: SendInboxMessageRequest | null;
  failedAttempt?: boolean;
}
export interface RestoredDraft {
  draft: TextDraft | null;
  unavailable: boolean;
  revision: string | null | undefined;
  requestKey?: string;
}
export interface PersistResult {
  status: 'saved' | 'unavailable' | 'conflict';
  revision?: string | null | undefined;
}

function scoped(key: string): boolean {
  try {
    const ids: unknown = JSON.parse(key);
    return (
      Array.isArray(ids) &&
      ids.length === 4 &&
      ids.every((id) => typeof id === 'string') &&
      ids.slice(0, 3).every(Boolean)
    );
  } catch {
    return false;
  }
}
function parse(raw: string | null) {
  if (!raw || raw.length > 20000) return null;
  try {
    const result = Record.safeParse(JSON.parse(raw));
    if (
      !result.success ||
      result.data.generation !== privateCacheGeneration() ||
      result.data.savedAt > Date.now() + 60000 ||
      Date.now() - result.data.savedAt >= MAX_AGE
    )
      return null;
    const record = result.data;
    return record.attempt &&
      (record.attempt.text !== record.text.trim() ||
        record.attempt.idempotencyKey !== record.requestKey)
      ? null
      : record;
  } catch {
    return null;
  }
}
export function restoreTextDraft(key: string): RestoredDraft {
  if (!scoped(key)) return { draft: null, unavailable: false, revision: undefined };
  try {
    const storageKey = DRAFT_STORAGE_PREFIX + key;
    const raw = window.localStorage.getItem(storageKey);
    const record = privateKeyInvalidated(storageKey, raw) ? null : parse(raw);
    if (!record) {
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* Never restore invalidated content. */
      }
      return { draft: null, unavailable: false, revision: null };
    }
    return {
      draft: {
        text: record.text,
        attempt: record.attempt,
        failedAttempt: record.failedAttempt ?? false,
      },
      unavailable: false,
      revision: raw,
      requestKey: record.requestKey,
    };
  } catch {
    return { draft: null, unavailable: true, revision: undefined };
  }
}
function prune(currentKey: string): void {
  const entries: { key: string; savedAt: number }[] = [];
  for (const key of Object.keys(window.localStorage)) {
    if (!key.startsWith(DRAFT_STORAGE_PREFIX)) continue;
    const record = parse(window.localStorage.getItem(key));
    if (!record) window.localStorage.removeItem(key);
    else entries.push({ key, savedAt: record.savedAt });
  }
  entries.sort(
    (a, b) => b.savedAt - a.savedAt || Number(b.key === currentKey) - Number(a.key === currentKey),
  );
  for (const entry of entries.slice(LIMIT)) window.localStorage.removeItem(entry.key);
}

/** Compare before editing/deleting so another tab's newer draft survives old send completion. */
export function draftRevisionMatches(key: string, expected: string | null | undefined): boolean {
  if (expected === undefined || !scoped(key)) return true;
  try {
    return window.localStorage.getItem(DRAFT_STORAGE_PREFIX + key) === expected;
  } catch {
    return true;
  }
}

/** Only DM text and text-send identity persist; attachments/notes never enter this record. */
export function persistTextDraft(
  key: string,
  draft: TextDraft,
  expected?: string | null,
  requestKey: string = crypto.randomUUID(),
): PersistResult {
  if (!scoped(key)) return { status: 'saved', revision: undefined };
  if (!draftRevisionMatches(key, expected)) return { status: 'conflict' };
  try {
    const storageKey = DRAFT_STORAGE_PREFIX + key;
    if (!draft.text) {
      window.localStorage.removeItem(storageKey);
      return { status: 'saved', revision: null };
    }
    publishPrivateCacheGeneration();
    const previous = window.localStorage.getItem(storageKey);
    const attempt =
      draft.attempt && !draft.attempt.attachment && draft.attempt.text === draft.text.trim()
        ? draft.attempt
        : null;
    const record = Record.parse({
      version: 1,
      requestKey,
      generation: privateCacheGeneration(),
      savedAt: Date.now(),
      text: draft.text,
      attempt,
      failedAttempt: draft.failedAttempt ?? false,
    });
    const raw = JSON.stringify(record);
    window.localStorage.setItem(storageKey, raw);
    markPrivateKeyFresh(storageKey);
    if (!previous) prune(storageKey);
    return { status: 'saved', revision: raw };
  } catch {
    return { status: 'unavailable' };
  }
}
