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
import type { z } from 'zod';

import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import {
  ContactNotFoundError,
  DuplicateContactRequestError,
  NoteNotFoundError,
  StaleVersionError,
} from '../domain/crm.errors.js';
import { DEFAULT_SOURCES } from '../domain/crm-defaults.js';
import { toContactDto, toHistoryDto, toNoteDto } from './crm.mappers.js';
import { applyFields } from './contact-fields.js';
import { DistributionService } from './distribution.service.js';
import {
  assertAssignable,
  assertChoosable,
  assertMayAssign,
  canSee,
  diff,
  scopeOf,
  startOfLocalDay,
  type Viewer,
} from './crm-rules.js';
import { CRM_STORE, type ContactRecord, type CrmStore, type CrmTx } from './ports/crm-store.js';

/** Fields whose change is reported as its own history type and event. */
const STATUS_FIELDS = ['statusId'] as const;
const ASSIGNMENT_FIELDS = ['salesUserId', 'careUserId'] as const;

/** Customers: profile, notes and the audit history (CRM-01). */
@Injectable()
export class ContactService {
  constructor(
    @Inject(CRM_STORE) private readonly store: CrmStore,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(DistributionService) private readonly distribution: DistributionService,
  ) {}

  /** Without a viewer (other modules) every customer is visible. */
  get(ws: WorkspaceId, id: string, viewer?: Viewer): Promise<ContactDto> {
    return this.store.run(ws, async (tx) =>
      this.#dto(tx, await this.#contact(tx, id, undefined, viewer)),
    );
  }

  /**
   * Idempotent per `clientRequestId`: a retried create returns the first contact,
   * also when two identical requests race (the loser returns the winner).
   */
  async create(ws: WorkspaceId, raw: unknown, viewer: Viewer): Promise<ContactDto> {
    try {
      return await this.#create(ws, raw, viewer);
    } catch (error) {
      const requestId = CreateContactRequest.parse(raw).clientRequestId;
      if (!(error instanceof DuplicateContactRequestError) || !requestId) throw error;
      return this.store.run(ws, async (tx) => {
        const first = await tx.contacts.findByRequestId(requestId);
        if (!first || !canSee(first, viewer)) throw error;
        return this.#dto(tx, first);
      });
    }
  }

  async #create(ws: WorkspaceId, raw: unknown, viewer: Viewer): Promise<ContactDto> {
    const actor = viewer.userId;
    const input = CreateContactRequest.parse(raw);
    const { clientRequestId, ...fields } = input;
    assertMayAssign(viewer, {}, fields);
    const [actorName] = await Promise.all([
      this.identity.displayName(userId(actor)),
      assertAssignable(this.workspaces, ws, fields),
    ]);
    return this.store.run(ws, async (tx) => {
      if (clientRequestId) {
        const first = await tx.contacts.findByRequestId(clientRequestId);
        if (first && canSee(first, viewer)) return this.#dto(tx, first);
      }
      await assertChoosable(tx, fields, {});
      // A scoped creator (Sales, CSKH) owns what they create, so they keep seeing it.
      const me = scopeOf(viewer);
      if (me && !fields.salesUserId && !fields.careUserId) {
        if (viewer.role === 'care') fields.careUserId = me;
        else fields.salesUserId = me;
      }
      // No Sales given: the source's auto-assignment policy may pick one (T-033).
      const autoSales =
        !fields.salesUserId && fields.sourceId
          ? await this.distribution.pick(tx, ws, fields.sourceId)
          : null;
      if (autoSales) fields.salesUserId = autoSales;
      const now = new Date();
      const empty = emptyContact(actor, now, clientRequestId);
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
        autoSales ? { autoAssigned: true } : {},
      );
      // Every owner a customer starts with is an ownership event (statistics attribute by the owner at the time).
      for (const [role, owner] of [
        ['sales', contact.salesUserId],
        ['care', contact.careUserId],
      ] as const) {
        if (!owner) continue;
        await tx.outbox(ws, {
          type: 'crm.contact.assigned.v1',
          aggregateId: contact.id,
          payload: event(ws, contact.id, actor, now, { role, fromUserId: null, toUserId: owner }),
        });
      }
      await tx.outbox(ws, {
        type: 'crm.contact.created.v1',
        aggregateId: contact.id,
        payload: event(ws, contact.id, actor, now, {
          sourceId: contact.sourceId,
          // The CRM form is the only way to create a customer today; channel and import come later.
          origin: 'manual',
          phoneCaptured: contact.phoneProvidedAt !== null,
          statusId: contact.statusId,
        }),
      });
      return this.#dto(tx, contact);
    });
  }

  /**
   * Lead capture from a channel (no staff actor): one customer per phone. The per-phone advisory
   * lock makes two concurrent captures of the same number serialize, so the second finds the first.
   */
  async findIdByPhone(ws: WorkspaceId, phoneE164: string): Promise<string | null> {
    return this.store.run(ws, async (tx) => (await tx.contacts.findByPhone(phoneE164))?.id ?? null);
  }

  async upsertLead(
    ws: WorkspaceId,
    input: { phoneE164: string; sourceKey: string; displayName: string; firstUrl: string | null },
  ): Promise<{ contactId: string; created: boolean }> {
    return this.store.run(ws, async (tx) => {
      await tx.lock(`phone/${input.phoneE164}`);
      const now = new Date();
      const found = await tx.contacts.findByPhone(input.phoneE164);
      if (found) {
        // Repeated or racing captures from the same page leave one entry.
        const marker = input.firstUrl ?? input.sourceKey;
        const earlier = await tx.history.list(found.id, {
          type: 'contact.updated',
          order: 'desc',
          limit: 100,
        });
        const recorded = earlier.some(
          (h) =>
            (h.changes['lead'] as { to?: unknown } | undefined)?.to === marker &&
            h.data['channel'] === input.sourceKey,
        );
        if (!recorded)
          await this.#record(
            tx,
            ws,
            found,
            'contact.updated',
            { lead: { from: null, to: marker } },
            null,
            null,
            now,
            { channel: input.sourceKey },
          );
        return { contactId: found.id, created: false };
      }
      await tx.options.ensureDefaults(ws, 'source', DEFAULT_SOURCES);
      const source = (await tx.options.list('source')).find((o) => o.key === input.sourceKey);
      const fields: Partial<z.output<typeof UpdateContactRequest>> = {
        name: input.displayName,
        phone: input.phoneE164,
        ...(source ? { sourceId: source.id } : {}),
      };
      const autoSales = source ? await this.distribution.pick(tx, ws, source.id) : null;
      if (autoSales) fields.salesUserId = autoSales;
      const empty = emptyContact(null, now);
      const contact = applyFields(empty, fields, now);
      await tx.contacts.insert(contact);
      await this.#record(
        tx,
        ws,
        contact,
        'contact.created',
        diff(empty, contact),
        null,
        null,
        now,
        { channel: input.sourceKey, ...(autoSales ? { autoAssigned: true } : {}) },
      );
      if (autoSales) {
        await tx.outbox(ws, {
          type: 'crm.contact.assigned.v1',
          aggregateId: contact.id,
          payload: event(ws, contact.id, null, now, {
            role: 'sales',
            fromUserId: null,
            toUserId: autoSales,
          }),
        });
      }
      await tx.outbox(ws, {
        type: 'crm.contact.created.v1',
        aggregateId: contact.id,
        payload: event(ws, contact.id, null, now, {
          sourceId: contact.sourceId,
          origin: 'channel',
          phoneCaptured: true,
          statusId: null,
        }),
      });
      return { contactId: contact.id, created: true };
    });
  }

  /**
   * A bot answered (or was answering) a conversation linked to the customer. Kept as history: a page
   * moved to another bot later does not erase it (T-088). Unknown customers answer NOT_FOUND.
   */
  async recordBot(ws: WorkspaceId, contactId: string, botId: string): Promise<void> {
    if (!isUuid(contactId)) throw new ContactNotFoundError(contactId);
    await this.store.run(ws, async (tx) => {
      if (!(await tx.contacts.find(contactId))) throw new ContactNotFoundError(contactId);
      await tx.contacts.recordBot(contactId, botId, new Date());
    });
  }

  /**
   * Edits only the fields sent. `expectedVersion` must be the stored version: a
   * stale edit answers CONFLICT and changes nothing. Status and assignment
   * changes get their own history entries and events.
   */
  async update(ws: WorkspaceId, id: string, raw: unknown, viewer: Viewer): Promise<ContactDto> {
    const actor = viewer.userId;
    const { expectedVersion, ...fields } = UpdateContactRequest.parse(raw);
    const actorName = await this.identity.displayName(userId(actor));
    return this.store.run(ws, async (tx) => {
      const before = await this.#contact(tx, id, { forUpdate: true }, viewer);
      assertMayAssign(viewer, before, fields);
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
          payload: event(ws, id, actor, now, {
            fields: Object.keys(rest),
            phoneCaptured: before.phoneProvidedAt === null && next.phoneProvidedAt !== null,
          }),
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

  async query(ws: WorkspaceId, raw: unknown, viewer?: Viewer): Promise<ContactListResponse> {
    const q = ContactQueryRequest.parse(raw);
    const timezone = (await this.workspaces.getById(ws)).timezone || 'Asia/Ho_Chi_Minh';
    return this.store.run(ws, async (tx) => {
      const { rows, total } = await tx.contacts.query({
        q: q.q ? foldVietnamese(q.q) : undefined,
        filter: q.filter,
        sort: q.sort,
        timezone,
        ownerScope: scopeOf(viewer),
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

  listNotes(ws: WorkspaceId, contactId: string, viewer?: Viewer): Promise<ContactNoteDto[]> {
    return this.store.run(ws, async (tx) => {
      await this.#contact(tx, contactId, undefined, viewer);
      return (await tx.notes.list(contactId)).map(toNoteDto);
    });
  }

  /** Internal note on the timeline; never sends anything to the customer. */
  async addNote(ws: WorkspaceId, contactId: string, raw: unknown, viewer: Viewer) {
    const actor = viewer.userId;
    const { body } = CreateContactNoteRequest.parse(raw);
    const actorName = await this.identity.displayName(userId(actor));
    return this.store.run(ws, async (tx) => {
      const contact = await this.#contact(tx, contactId, undefined, viewer);
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
    viewer: Viewer,
  ): Promise<ContactNoteDto> {
    const actor = viewer.userId;
    const { body, expectedVersion } = UpdateContactNoteRequest.parse(raw);
    const actorName = await this.identity.displayName(userId(actor));
    return this.store.run(ws, async (tx) => {
      const contact = await this.#contact(tx, contactId, undefined, viewer);
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

  async history(
    ws: WorkspaceId,
    contactId: string,
    raw: unknown,
    viewer?: Viewer,
  ): Promise<ContactHistoryEntry[]> {
    const q = ContactHistoryQuery.parse(raw);
    const timezone = (await this.workspaces.getById(ws)).timezone || 'Asia/Ho_Chi_Minh';
    return this.store.run(ws, async (tx) => {
      await this.#contact(tx, contactId, undefined, viewer);
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

  /** A customer outside the viewer's scope does not exist for them (404). */
  async #contact(
    tx: CrmTx,
    id: string,
    opts?: { forUpdate: boolean },
    viewer?: Viewer,
  ): Promise<ContactRecord> {
    const c = isUuid(id) ? await tx.contacts.find(id, opts) : null;
    if (!c || !canSee(c, viewer)) throw new ContactNotFoundError(id);
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

function emptyContact(
  createdBy: string | null,
  now: Date,
  clientRequestId?: string | null,
): ContactRecord {
  return {
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
    createdByUserId: createdBy,
    createdAt: now,
    updatedAt: now,
  };
}
