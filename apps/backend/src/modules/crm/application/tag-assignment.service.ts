import {
  AssignTagRequest,
  RemoveTagAssignmentRequest,
  type TagAssignmentDto,
  UpdateTagAssignmentRequest,
} from '@agent-sales/contracts';
import { isUuid, newId, userId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import {
  ArchivedChoiceError,
  ContactNotFoundError,
  StaleVersionError,
  TagAssignmentNotFoundError,
  TagNotFoundError,
  TagValuesInvalidError,
} from '../domain/crm.errors.js';
import { validateTagValues } from '../domain/tag-values.js';
import { canSee, type Viewer } from './crm-rules.js';
import { toAssignmentDto } from './crm.mappers.js';
import { CRM_STORE, type AssignmentRecord, type CrmStore, type CrmTx } from './ports/crm-store.js';

/**
 * Tags on customers (CRM-04); `remove` also serves conversation tags (see ConversationTagsService). Classification and attribute tags are active at
 * most once per customer, so a retried "add" returns the existing assignment
 * and a retried "remove" is a no-op: neither writes a second event. Values are
 * validated on the server against the tag's fields.
 */
@Injectable()
export class TagAssignmentService {
  constructor(
    @Inject(CRM_STORE) private readonly store: CrmStore,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
  ) {}

  list(ws: WorkspaceId, contactId: string, viewer?: Viewer): Promise<TagAssignmentDto[]> {
    return this.store.run(ws, async (tx) => {
      await this.#contact(tx, contactId, viewer);
      return (await tx.assignments.listFor('contact', [contactId], true)).map(toAssignmentDto);
    });
  }

  /** Resolves `created` false when the tag was already on the customer. */
  async assign(
    ws: WorkspaceId,
    contactId: string,
    raw: unknown,
    viewer: Viewer,
  ): Promise<{ created: boolean; assignment: TagAssignmentDto }> {
    const input = AssignTagRequest.parse(raw);
    const actor = viewer.userId;
    const actorName = await this.identity.displayName(userId(actor));
    return this.store.run(ws, async (tx) => {
      await this.#contact(tx, contactId, viewer);
      // Locked: an archive or a field change cannot slip in between validation and insert.
      const tag = await tx.tags.find(input.tagId, { forUpdate: true });
      if (!tag) throw new TagNotFoundError(input.tagId);
      if (tag.archivedAt) throw new ArchivedChoiceError('tag', tag.id);
      if (tag.type !== 'work') {
        const existing = await tx.assignments.findActive(tag.id, 'contact', contactId);
        if (existing) return { created: false, assignment: toAssignmentDto(existing) };
      }
      const checked = validateTagValues(tag.fields, input.values);
      if (!checked.ok) throw new TagValuesInvalidError(checked.errors);
      const now = new Date();
      const assignment: AssignmentRecord = {
        id: newId(),
        tagId: tag.id,
        tagType: tag.type,
        scope: 'contact',
        entityId: contactId,
        values: checked.values,
        schemaVersion: tag.schemaVersion,
        assignedAt: now,
        assignedByUserId: actor,
        assignedByName: actorName,
        removedAt: null,
        removedByUserId: null,
        removeReason: null,
        version: 1,
      };
      if (!(await tx.assignments.insert(ws, assignment))) {
        // Lost a race with an identical request: return the winner.
        const winner = await tx.assignments.findActive(tag.id, 'contact', contactId);
        if (winner) return { created: false, assignment: toAssignmentDto(winner) };
        // The winner was removed in between: nothing was stored, so record nothing.
        throw new StaleVersionError('tag', tag.version);
      }
      await this.#history(tx, contactId, 'tag.added', actor, actorName, now, {
        tagId: tag.id,
        tagName: tag.name,
        assignmentId: assignment.id,
        values: assignment.values,
      });
      await tx.outbox(ws, {
        type: 'crm.tag.assigned.v1',
        aggregateId: contactId,
        payload: {
          workspaceId: ws,
          contactId,
          actorUserId: actor,
          occurredAt: now.toISOString(),
          assignmentId: assignment.id,
          tagId: tag.id,
          scope: 'contact',
        },
      });
      return { created: true, assignment: toAssignmentDto(assignment) };
    });
  }

  async updateValues(
    ws: WorkspaceId,
    assignmentId: string,
    raw: unknown,
    viewer: Viewer,
  ): Promise<TagAssignmentDto> {
    const actor = viewer.userId;
    const input = UpdateTagAssignmentRequest.parse(raw);
    const actorName = await this.identity.displayName(userId(actor));
    return this.store.run(ws, async (tx) => {
      const a = await this.#assignment(tx, assignmentId, true);
      await this.#contact(tx, a.entityId, viewer);
      if (a.removedAt) throw new TagAssignmentNotFoundError(assignmentId);
      if (a.version !== input.expectedVersion) throw new StaleVersionError('tag', a.version);
      const tag = await tx.tags.find(a.tagId);
      if (!tag) throw new TagNotFoundError(a.tagId);
      const checked = validateTagValues(tag.fields, input.values, a.values);
      if (!checked.ok) throw new TagValuesInvalidError(checked.errors);
      const next = {
        ...a,
        values: checked.values,
        schemaVersion: tag.schemaVersion,
        version: a.version + 1,
      };
      await tx.assignments.update(next);
      await this.#history(tx, a.entityId, 'tag.updated', actor, actorName, new Date(), {
        tagId: tag.id,
        tagName: tag.name,
        assignmentId: a.id,
        values: { from: a.values, to: next.values },
      });
      return toAssignmentDto(next);
    });
  }

  /** Idempotent: removing a removed assignment returns it unchanged. */
  async remove(
    ws: WorkspaceId,
    assignmentId: string,
    raw: unknown,
    viewer: Viewer,
  ): Promise<TagAssignmentDto> {
    const actor = viewer.userId;
    const { reason } = RemoveTagAssignmentRequest.parse(raw);
    const actorName = await this.identity.displayName(userId(actor));
    return this.store.run(ws, async (tx) => {
      const a = await this.#assignment(tx, assignmentId, true, ['contact', 'conversation']);
      const forConversation = a.scope === 'conversation';
      if (!forConversation) await this.#contact(tx, a.entityId, viewer);
      if (a.removedAt) return toAssignmentDto(a);
      const now = new Date();
      const next = {
        ...a,
        removedAt: now,
        removedByUserId: actor,
        removeReason: reason ?? null,
        version: a.version + 1,
      };
      await tx.assignments.update(next);
      // A conversation tag has no customer history and publishes no event.
      if (forConversation) return toAssignmentDto(next);
      const tag = await tx.tags.find(a.tagId);
      await this.#history(tx, a.entityId, 'tag.removed', actor, actorName, now, {
        tagId: a.tagId,
        tagName: tag?.name ?? null,
        assignmentId: a.id,
        reason: reason ?? null,
      });
      await tx.outbox(ws, {
        type: 'crm.tag.removed.v1',
        aggregateId: a.entityId,
        payload: {
          workspaceId: ws,
          contactId: a.entityId,
          actorUserId: actor,
          occurredAt: now.toISOString(),
          assignmentId: a.id,
          tagId: a.tagId,
          scope: a.scope,
        },
      });
      return toAssignmentDto(next);
    });
  }

  /** Customers outside the viewer's scope do not exist for them. */
  async #contact(tx: CrmTx, id: string, viewer?: Viewer): Promise<void> {
    const c = isUuid(id) ? await tx.contacts.find(id) : null;
    if (!c || !canSee(c, viewer)) throw new ContactNotFoundError(id);
  }

  async #assignment(
    tx: CrmTx,
    id: string,
    forUpdate: boolean,
    scopes: readonly AssignmentRecord['scope'][] = ['contact'],
  ): Promise<AssignmentRecord> {
    const a = isUuid(id) ? await tx.assignments.find(id, { forUpdate }) : null;
    if (!a || !scopes.includes(a.scope)) throw new TagAssignmentNotFoundError(id);
    return a;
  }

  #history(
    tx: CrmTx,
    contactId: string,
    type: string,
    actor: string,
    actorName: string | null,
    at: Date,
    data: Record<string, unknown>,
  ): Promise<void> {
    return tx.history.add({
      id: newId(),
      contactId,
      type,
      changes: {},
      data,
      actorUserId: actor,
      actorName,
      createdAt: at,
    });
  }
}
