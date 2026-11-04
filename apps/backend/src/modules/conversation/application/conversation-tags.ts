import type { ConversationListQuery, ConversationView } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Logger } from '@nestjs/common';
import type { CrmFacade } from '../../crm/api/index.js';

const log = new Logger('ConversationTags');

/** The name a website visitor's conversation gets until the customer is known (see `named`). */
const WEBSITE_PLACEHOLDER = /^Khách website /;

/**
 * Fills `tags` from the crm tag library; the document never stores them. Chips are decoration:
 * if the library is unavailable the conversation still loads, without them (tag *filters* do fail).
 * It also shows the crm customer's name on website conversations (see `attachContactNames`).
 */
export async function attachTags(
  crm: CrmFacade,
  ws: WorkspaceId,
  rows: ConversationView[],
): Promise<ConversationView[]> {
  if (!rows.length) return rows;
  const named = await attachContactNames(crm, ws, rows);
  try {
    const chips = await crm.conversationTags(
      ws,
      named.map((c) => c.id),
    );
    return named.map((c) => ({ ...c, tags: chips.get(c.id) ?? [] }));
  } catch {
    log.warn('Tag chips unavailable; returning conversations without tags');
    return named;
  }
}

/**
 * A website visitor has no channel profile, so the conversation keeps "Khách website …" while the
 * linked crm customer learns the real name (the bot's request tool, staff). The inbox shows the
 * customer's name once it has one that is not a placeholder itself. Decoration: never throws.
 */
export async function attachContactNames(
  crm: CrmFacade,
  ws: WorkspaceId,
  rows: ConversationView[],
): Promise<ConversationView[]> {
  const ids = [
    ...new Set(
      rows.flatMap((c) =>
        c.contactId && WEBSITE_PLACEHOLDER.test(c.customerName) ? [c.contactId] : [],
      ),
    ),
  ];
  if (!ids.length) return rows;
  try {
    const names = await crm.contactNames(ws, ids);
    return rows.map((c) => {
      const name = c.contactId ? names.get(c.contactId)?.trim() : undefined;
      return name && WEBSITE_PLACEHOLDER.test(c.customerName) && !WEBSITE_PLACEHOLDER.test(name)
        ? { ...c, customerName: name }
        : c;
    });
  } catch {
    log.warn('Customer names unavailable; returning conversations with their own names');
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
