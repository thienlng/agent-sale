import type { AssistantLearningFeed, AssistantLearningItemDto } from '@agent-sales/contracts';

import { isKnownStore } from '../domain/memory-store.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { AssistantRepository } from '../domain/ports/assistant.repository.js';

/** Items the feed lists at most. */
export const LEARNING_FEED_LIMIT = 20;
const DAY_MS = 24 * 60 * 60_000;

/**
 * "Trợ lý vừa học" (ruling 1c-R2): the owner's skill ledger rows by the review or the curator,
 * plus memory entries with origin `review` (saved or rewritten in the window), from the last
 * `days` days, newest first, at most 20. Each item carries its undo handle: the ledger entry id,
 * or the memory store and entry id (undone by the existing delete). Memory in a business store
 * the owner no longer belongs to is left out (its delete would be 404).
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

  const items: AssistantLearningItemDto[] = [];
  for (const e of [...review, ...curator]) {
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
      state: e.after?.state ?? null,
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
        at: at.toISOString(),
      });
    }
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { items: items.slice(0, LEARNING_FEED_LIMIT) };
}
