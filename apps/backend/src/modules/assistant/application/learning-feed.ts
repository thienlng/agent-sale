import type { AssistantLearningFeed, AssistantLearningItemDto } from '@agent-sales/contracts';

import { isKnownStore } from '../domain/memory-store.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { AssistantRepository, MemoryEntry } from '../domain/ports/assistant.repository.js';

/** Items the feed lists at most. */
export const LEARNING_FEED_LIMIT = 20;
const DAY_MS = 24 * 60 * 60_000;

/**
 * "Trợ lý vừa học" (ruling 1c-R2): the owner's skill ledger rows by the review or the curator,
 * plus memory entries with origin `review` (saved or rewritten in the window), from the last
 * `days` days, newest first, at most 20. Each item carries its undo handle: the ledger entry id,
 * or the memory store and entry id (`undoReviewEntry`: a rewrite is restored, an addition is
 * forgotten). A skill row shows the skill's current state, not its event's (QA N-4). Memory in a
 * business store the owner no longer belongs to is left out (its delete would be 404).
 */
export async function learningFeed(
  repo: AssistantRepository,
  scope: OwnerScope,
  days: number,
  now = new Date(),
): Promise<AssistantLearningFeed> {
  const since = new Date(now.getTime() - days * DAY_MS);
  const [review, curator, memory] = await Promise.all([
    repo.listSkillEvents(scope, { since, actor: 'review', limit: LEARNING_FEED_LIMIT }),
    repo.listSkillEvents(scope, { since, actor: 'curator', limit: LEARNING_FEED_LIMIT }),
    repo.getMemory(scope),
  ]);

  const events = [...review, ...curator];
  const skillIds = [...new Set(events.map((e) => e.skillId))];
  const current = new Map(
    (await Promise.all(skillIds.map((id) => repo.getSkill(scope, id)))).flatMap((s) =>
      s ? [[s.id, s.state] as const] : [],
    ),
  );

  const items: AssistantLearningItemDto[] = [];
  for (const e of events) {
    const shown = e.after ?? e.before;
    if (!shown || (e.actor !== 'review' && e.actor !== 'curator')) continue;
    items.push({
      kind: 'skill',
      actor: e.actor,
      action: e.action,
      skillEventId: e.id,
      skillId: e.skillId,
      name: shown.name,
      description: shown.description,
      state: current.get(e.skillId) ?? null,
      undone: e.undoneAt !== null,
      at: e.createdAt.toISOString(),
    });
  }
  for (const store of memory) {
    if (!isKnownStore(store.store, scope.businessIds)) continue;
    for (const entry of store.entries) {
      if (entry.origin !== 'review') continue;
      const at = new Date(entry.updatedAt ?? entry.createdAt);
      if (Number.isNaN(at.getTime()) || at.getTime() < since.getTime()) continue;
      items.push({
        kind: 'memory',
        actor: 'review',
        store: store.store,
        entryId: entry.id,
        text: entry.text,
        previousText: entry.previousText ?? null,
        at: at.toISOString(),
      });
    }
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { items: items.slice(0, LEARNING_FEED_LIMIT) };
}

/**
 * The store's entries once the review's change to `entryId` is undone, or null when there is no
 * such entry: an entry the review rewrote gets its previous text and origin back; any other entry
 * is forgotten (the review added it, or nothing older is kept).
 */
export function undoReviewEntry(entries: MemoryEntry[], entryId: string): MemoryEntry[] | null {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return null;
  if (entry.origin !== 'review' || entry.previousText === undefined) {
    return entries.filter((e) => e !== entry);
  }
  const { previousText, previousOrigin, ...rest } = entry;
  const restored: MemoryEntry = {
    ...rest,
    text: previousText,
    origin: previousOrigin ?? 'assistant',
    updatedAt: new Date().toISOString(),
  };
  return entries.map((e) => (e === entry ? restored : e));
}
