import {
  type ContactDto,
  type ContactHistoryEntry,
  ContactHistoryQuery,
  type ContactListResponse,
  type ContactNoteDto,
  ContactQueryRequest,
  CreateContactNoteRequest,
  CreateContactRequest,
  UpdateContactNoteRequest,
  UpdateContactRequest,
} from '@agent-sales/contracts';
import { foldVietnamese, isUuid, newId, userId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import type { CrmFacade } from '../api/crm.facade.js';
import {
  ContactNotFoundError,
  DuplicateContactRequestError,
  NoteNotFoundError,
  StaleVersionError,
} from '../domain/crm.errors.js';
import { toContactDto, toHistoryDto, toNoteDto } from './crm.mappers.js';
import { applyFields } from './contact-fields.js';
import { assertAssignable, assertChoosable, diff, startOfLocalDay } from './crm-rules.js';
import { CRM_STORE, type ContactRecord, type CrmStore, type CrmTx } from './ports/crm-store.js';

/** Fields whose change is reported as its own history type and event. */
const STATUS_FIELDS = ['statusId'] as const;
const ASSIGNMENT_FIELDS = ['salesUserId', 'careUserId'] as const;

/** Customers: profile, notes and the audit history (CRM-01). */
@Injectable()
export class ContactService implements CrmFacade {
  constructor(
    @Inject(CRM_STORE) private readonly store: CrmStore,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
  ) {}

  getContact(ws: WorkspaceId, id: string): Promise<ContactDto> {
    return this.get(ws, id);
  }

  get(ws: WorkspaceId, id: string): Promise<ContactDto> {
    return this.store.run(ws, async (tx) => this.#dto(tx, await this.#contact(tx, id)));
  }

  /**
   * Idempotent per `clientRequestId`: a retried create returns the first contact,
   * also when two identical requests race (the loser returns the winner).
   */
  async create(ws: WorkspaceId, raw: unknown, actor: string): Promise<ContactDto> {
    try {
      return await this.#create(ws, raw, actor);
    } catch (error) {
      const requestId = CreateContactRequest.parse(raw).clientRequestId;
      if (!(error instanceof DuplicateContactRequestError) || !requestId) throw error;
      return this.store.run(ws, async (tx) => {
        const first = await tx.contacts.findByRequestId(requestId);
        if (!first) throw error;
        return this.#dto(tx, first);
      });
    }
  }

  async #create(ws: WorkspaceId, raw: unknown, actor: string): Promise<ContactDto> {
    const input = CreateContactRequest.parse(raw);
    const { clientRequestId, ...fields } = input;
    const [actorName] = await Promise.all([
      this.identity.displayName(userId(actor)),
      assertAssignable(this.workspaces, ws, fields),
    ]);
    return this.store.run(ws, async (tx) => {
      if (clientRequestId) {
        const first = await tx.contacts.findByRequestId(clientRequestId);
        if (first) return this.#dto(tx, first);
      }
      await assertChoosable(tx, fields, {});
      const now = new Date();
      const empty: ContactRecord = {
        id: newId(),
        name: null,
        phone: null,
        phoneNormalized: null,
        email: null,
        emailNormalized: null,
        birthday: null,
        gender: null,
        address: null,
        province: null,
        ward: null,
        phoneProvidedAt: null,
        addressProvidedAt: null,
        sourceId: null,
        firstSourceId: null,
        statusId: null,
        salesUserId: null,
        careUserId: null,
        adRef: null,
        profileNote: '',
        searchText: '',
        clientRequestId: clientRequestId ?? null,
        version: 1,
        createdByUserId: actor,
        createdAt: now,
        updatedAt: now,
      };
      const contact = applyFields(empty, fields, now);
      await tx.contacts.insert(contact);
      await this.#record(
        tx,
        ws,
        contact,
        'contact.created',
        diff(empty, contact),
        actor,
        actorName,
        now,
      );
      await tx.outbox(ws, {
        type: 'crm.contact.created.v1',
        aggregateId: contact.id,
        payload: event(ws, contact.id, actor, now, { sourceId: contact.sourceId }),
      });
      return this.#dto(tx, contact);
    });
  }

  /**
   * Edits only the fields sent. `expectedVersion` must be the stored version: a
   * stale edit answers CONFLICT and changes nothing. Status and assignment
   * changes get their own history entries and events.
   */
  async update(ws: WorkspaceId, id: string, raw: unknown, actor: string): Promise<ContactDto> {
    const { expectedVersion, ...fields } = UpdateContactRequest.parse(raw);
    const actorName = await this.identity.displayName(userId(actor));
    return this.store.run(ws, async (tx) => {
      const before = await this.#contact(tx, id, { forUpdate: true });
      if (before.version !== expectedVersion) {
        throw new StaleVersionError('contact', before.version);
      }
      // Only a newly chosen owner must be a member: re-sending the current one is fine.
      await assertAssignable(this.workspaces, ws, {
        salesUserId: fields.salesUserId !== before.salesUserId ? fields.salesUserId : undefined,
        careUserId: fields.careUserId !== before.careUserId ? fields.careUserId : undefined,
      });
      await assertChoosable(tx, fields, before);
      const now = new Date();
      const after = applyFields(before, fields, now);
      const changes = diff(before, after);
      if (!Object.keys(changes).length) return this.#dto(tx, before);

      const next = { ...after, version: before.version + 1, updatedAt: now };
      if (!(await tx.contacts.update(next, expectedVersion))) {
        throw new StaleVersionError('contact', before.version + 1);
      }
      const pick = (keys: readonly string[]) =>
        Object.fromEntries(Object.entries(changes).filter(([k]) => keys.includes(k)));
      const rest = Object.fromEntries(
        Object.entries(changes).filter(
          ([k]) => ![...STATUS_FIELDS, ...ASSIGNMENT_FIELDS].includes(k as never),
        ),
      );
      const status = pick(STATUS_FIELDS);
      const assigned = pick(ASSIGNMENT_FIELDS);
      if (Object.keys(rest).length) {
        await this.#record(tx, ws, next, 'contact.updated', rest, actor, actorName, now);
        await tx.outbox(ws, {
          type: 'crm.contact.updated.v1',
          aggregateId: id,
          payload: event(ws, id, actor, now, { fields: Object.keys(rest) }),
        });
      }
      if (status['statusId']) {
        await this.#record(tx, ws, next, 'contact.status_changed', status, actor, actorName, now);
        await tx.outbox(ws, {
          type: 'crm.contact.status_changed.v1',
          aggregateId: id,
          payload: event(ws, id, actor, now, {
            fromStatusId: before.statusId,
            toStatusId: next.statusId,
          }),
        });
      }
      if (Object.keys(assigned).length) {
        await this.#record(tx, ws, next, 'contact.assigned', assigned, actor, actorName, now);
        for (const [field, role] of [
          ['salesUserId', 'sales'],
          ['careUserId', 'care'],
        ] as const) {
          if (!assigned[field]) continue;
          await tx.outbox(ws, {
            type: 'crm.contact.assigned.v1',
            aggregateId: id,
            payload: event(ws, id, actor, now, {
              role,
              fromUserId: before[field],
              toUserId: next[field],
            }),
          });
        }
      }
      return this.#dto(tx, next);
    });
  }

  async query(ws: WorkspaceId, raw: unknown): Promise<ContactListResponse> {
    const q = ContactQueryRequest.parse(raw);
    const timezone = (await this.workspaces.getById(ws)).timezone || 'Asia/Ho_Chi_Minh';
    return this.store.run(ws, async (tx) => {
      const { rows, total } = await tx.contacts.query({
        q: q.q ? foldVietnamese(q.q) : undefined,
        filter: q.filter,
        sort: q.sort,
        timezone,
        offset: (q.page - 1) * q.pageSize,
        limit: q.pageSize,
      });
      const tags = await tx.assignments.listFor(
        'contact',
        rows.map((r) => r.id),
        false,
      );
      return {
        data: rows.map((r) =>
          toContactDto(
            r,
            tags.filter((t) => t.entityId === r.id),
          ),
        ),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  // ─── notes ────────────────────────────────────────────────────────────────

  listNotes(ws: WorkspaceId, contactId: string): Promise<ContactNoteDto[]> {
    return this.store.run(ws, async (tx) => {
      await this.#contact(tx, contactId);
      return (await tx.notes.list(contactId)).map(toNoteDto);
    });
  }

  /** Internal note on the timeline; never sends anything to the customer. */
  async addNote(ws: WorkspaceId, contactId: string, raw: unknown, actor: string) {
    const { body } = CreateContactNoteRequest.parse(raw);
    const actorName = await this.identity.displayName(userId(actor));
    return this.store.run(ws, async (tx) => {
      const contact = await this.#contact(tx, contactId);
      const now = new Date();
      const note = {
        id: newId(),
        contactId,
        body,
        authorUserId: actor,
        authorName: actorName,
        version: 1,
        createdAt: now,
        editedAt: null,
      };
      await tx.notes.insert(note);
      await this.#record(tx, ws, contact, 'note.added', {}, actor, actorName, now, {
        noteId: note.id,
        body,
      });
      return toNoteDto(note);
    });
  }

  async editNote(
    ws: WorkspaceId,
    contactId: string,
    noteId: string,
    raw: unknown,
    actor: string,
  ): Promise<ContactNoteDto> {
    const { body, expectedVersion } = UpdateContactNoteRequest.parse(raw);
    const actorName = await this.identity.displayName(userId(actor));
    return this.store.run(ws, async (tx) => {
      const contact = await this.#contact(tx, contactId);
      const note = isUuid(noteId) ? await tx.notes.find(noteId, { forUpdate: true }) : null;
      if (!note || note.contactId !== contactId) throw new NoteNotFoundError(noteId);
      if (note.version !== expectedVersion) throw new StaleVersionError('note', note.version);
      if (note.body === body) return toNoteDto(note);
      const now = new Date();
      const next = { ...note, body, version: note.version + 1, editedAt: now };
      await tx.notes.update(next);
      // The earlier body stays in the history: edits are revisions, not overwrites.
      await this.#record(
        tx,
        ws,
        contact,
        'note.edited',
        { body: { from: note.body, to: body } },
        actor,
        actorName,
        now,
        { noteId },
      );
      return toNoteDto(next);
    });
  }

  async history(ws: WorkspaceId, contactId: string, raw: unknown): Promise<ContactHistoryEntry[]> {
    const q = ContactHistoryQuery.parse(raw);
    const timezone = (await this.workspaces.getById(ws)).timezone || 'Asia/Ho_Chi_Minh';
    return this.store.run(ws, async (tx) => {
      await this.#contact(tx, contactId);
      const rows = await tx.history.list(contactId, {
        type: q.type,
        from: q.from ? startOfLocalDay(q.from, timezone, 0) : undefined,
        to: q.to ? startOfLocalDay(q.to, timezone, 1) : undefined,
        order: q.order,
        limit: q.limit,
      });
      return rows.map(toHistoryDto);
    });
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  async #contact(tx: CrmTx, id: string, opts?: { forUpdate: boolean }): Promise<ContactRecord> {
    const c = isUuid(id) ? await tx.contacts.find(id, opts) : null;
    if (!c) throw new ContactNotFoundError(id);
    return c;
  }

  async #dto(tx: CrmTx, c: ContactRecord): Promise<ContactDto> {
    return toContactDto(c, await tx.assignments.listFor('contact', [c.id], false));
  }

  #record(
    tx: CrmTx,
    _ws: WorkspaceId,
    c: Pick<ContactRecord, 'id'>,
    type: string,
    changes: Record<string, { from: unknown; to: unknown }>,
    actor: string | null,
    actorName: string | null,
    at: Date,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    return tx.history.add({
      id: newId(),
      contactId: c.id,
      type,
      changes,
      data,
      actorUserId: actor,
      actorName,
      createdAt: at,
    });
  }
}

function event(
  ws: WorkspaceId,
  contactId: string,
  actor: string | null,
  at: Date,
  extra: Record<string, unknown>,
) {
  return {
    workspaceId: ws,
    contactId,
    actorUserId: actor,
    occurredAt: at.toISOString(),
    ...extra,
  };
}
