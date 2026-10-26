import {
  AssignTagRequest,
  type ConversationTagAssignmentDto,
  type ConversationTagChip,
} from '@agent-sales/contracts';
import { isUuid, newId, userId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import {
  ArchivedChoiceError,
  StaleVersionError,
  TagNotFoundError,
  TagValuesInvalidError,
} from '../domain/crm.errors.js';
import { resolveTagFilter, type TagFilter, type TagFilterResult } from '../domain/tag-filter.js';
import { validateTagValues } from '../domain/tag-values.js';
import { toAssignmentDto } from './crm.mappers.js';
import { CRM_STORE, type AssignmentRecord, type CrmStore } from './ports/crm-store.js';

/**
 * Tags on conversations (inbox v2). They share the tag library and `crm_tag_assignments` with
 * customers (`scope = 'conversation'`). The conversation module checks the conversation exists
 * before calling; nothing here touches customers, so there is no customer history or event.
 */
@Injectable()
export class ConversationTagsService {
  constructor(
    @Inject(CRM_STORE) private readonly store: CrmStore,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
  ) {}

  list(ws: WorkspaceId, conversationId: string): Promise<ConversationTagAssignmentDto[]> {
    return this.store.run(ws, async (tx) => {
      const [records, chips] = await Promise.all([
        tx.assignments.listFor('conversation', [conversationId], false),
        tx.assignments.activePairs('conversation', { entityIds: [conversationId] }),
      ]);
      // Assignments of archived tags are hidden, like in the chips.
      return records.flatMap((a) => {
        const chip = chips.find((c) => c.tagId === a.tagId);
        return chip ? [withChip(a, chip)] : [];
      });
    });
  }

  /** Resolves `created` false when the tag was already on the conversation. */
  async assign(
    ws: WorkspaceId,
    conversationId: string,
    raw: unknown,
    actor: string,
  ): Promise<{ created: boolean; assignment: ConversationTagAssignmentDto }> {
    const input = AssignTagRequest.parse(raw);
    const actorName = await this.identity.displayName(userId(actor));
    return this.store.run(ws, async (tx) => {
      // Locked: an archive or a field change cannot slip in between validation and insert.
      const tag = await tx.tags.find(input.tagId, { forUpdate: true });
      if (!tag) throw new TagNotFoundError(input.tagId);
      if (tag.archivedAt) throw new ArchivedChoiceError('tag', tag.id);
      const chip = {
        tagId: tag.id,
        tagName: tag.name,
        tagColor: tag.color,
        entityId: conversationId,
      };
      if (tag.type !== 'work') {
        const existing = await tx.assignments.findActive(tag.id, 'conversation', conversationId);
        if (existing) return { created: false, assignment: withChip(existing, chip) };
      }
      const checked = validateTagValues(tag.fields, input.values);
      if (!checked.ok) throw new TagValuesInvalidError(checked.errors);
      const assignment: AssignmentRecord = {
        id: newId(),
        tagId: tag.id,
        tagType: tag.type,
        scope: 'conversation',
        entityId: conversationId,
        values: checked.values,
        schemaVersion: tag.schemaVersion,
        assignedAt: new Date(),
        assignedByUserId: actor,
        assignedByName: actorName,
        removedAt: null,
        removedByUserId: null,
        removeReason: null,
        version: 1,
      };
      if (!(await tx.assignments.insert(ws, assignment))) {
        // Lost a race with an identical request: return the winner.
        const winner = await tx.assignments.findActive(tag.id, 'conversation', conversationId);
        if (winner) return { created: false, assignment: withChip(winner, chip) };
        throw new StaleVersionError('tag', tag.version);
      }
      return { created: true, assignment: withChip(assignment, chip) };
    });
  }

  /** Tag chips for list rows, oldest assignment first; conversations without tags are absent. */
  chips(
    ws: WorkspaceId,
    conversationIds: readonly string[],
  ): Promise<Map<string, ConversationTagChip[]>> {
    return this.store.run(ws, async (tx) => {
      const ids = conversationIds.filter(isUuid);
      const result = new Map<string, ConversationTagChip[]>();
      for (const p of await tx.assignments.activePairs('conversation', { entityIds: ids })) {
        const list = result.get(p.entityId) ?? [];
        if (!list.some((c) => c.id === p.tagId))
          list.push({ id: p.tagId, name: p.tagName, color: p.tagColor });
        result.set(p.entityId, list);
      }
      return result;
    });
  }

  idsByTags(ws: WorkspaceId, filter: TagFilter): Promise<TagFilterResult> {
    const named = [
      ...new Set([...(filter.any ?? []), ...(filter.all ?? []), ...(filter.exclude ?? [])]),
    ];
    return this.store.run(ws, async (tx) => {
      const pairs = named.length
        ? await tx.assignments.activePairs('conversation', { tagIds: named })
        : [];
      const tagged = filter.untagged
        ? new Set((await tx.assignments.activePairs('conversation', {})).map((p) => p.entityId))
        : new Set<string>();
      return resolveTagFilter(filter, pairs, tagged);
    });
  }
}

function withChip(
  a: AssignmentRecord,
  chip: { tagId: string; tagName: string; tagColor: string },
): ConversationTagAssignmentDto {
  return {
    ...toAssignmentDto(a),
    tag: { id: chip.tagId, name: chip.tagName, color: chip.tagColor },
  };
}
