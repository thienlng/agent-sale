import type { ConversationListQuery, ConversationView } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Logger } from '@nestjs/common';
import type { CrmFacade } from '../../crm/api/index.js';

const log = new Logger('ConversationTags');

/**
 * Fills `tags` from the crm tag library; the document never stores them. Chips are decoration:
 * if the library is unavailable the conversation still loads, without them (tag *filters* do fail).
 */
export async function attachTags(
  crm: CrmFacade,
  ws: WorkspaceId,
  rows: ConversationView[],
): Promise<ConversationView[]> {
  if (!rows.length) return rows;
  try {
    const chips = await crm.conversationTags(
      ws,
      rows.map((c) => c.id),
    );
    return rows.map((c) => ({ ...c, tags: chips.get(c.id) ?? [] }));
  } catch {
    log.warn('Tag chips unavailable; returning conversations without tags');
    return rows;
  }
}

/** The id sets implementing the list's tag conditions, or `{}` when none was asked for. */
export async function tagConditions(
  crm: CrmFacade,
  ws: WorkspaceId,
  q: Pick<ConversationListQuery, 'tagsAny' | 'tagsAll' | 'tagsExclude' | 'untagged'>,
): Promise<{ idsIn?: string[]; idsNotIn?: string[] }> {
  if (!q.tagsAny?.length && !q.tagsAll?.length && !q.tagsExclude?.length && !q.untagged) return {};
  const match = await crm.conversationIdsByTags(ws, {
    any: q.tagsAny,
    all: q.tagsAll,
    exclude: q.tagsExclude,
    untagged: q.untagged,
  });
  return { ...(match.include ? { idsIn: match.include } : {}), idsNotIn: match.exclude };
}
