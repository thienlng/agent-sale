import {
  type ContactDto,
  type ContactHistoryEntry,
  ContactHistoryQuery,
  type ContactListResponse,
  type ContactNoteDto,
  type CustomerRequestKind,
  type RequestProfile,
  type RequestStatusMove,
  ContactQueryRequest,
  CreateContactNoteRequest,
  CreateContactRequest,
  isRequestIndustry,
  memberRoleOf,
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
  InvalidContactError,
  NoteNotFoundError,
  StaleVersionError,
} from '../domain/crm.errors.js';
import { lockedFields } from '../domain/external-contact.js';
import { DEFAULT_SOURCES, defaultStatusesFor } from '../domain/crm-defaults.js';
import {
  BOT_AUTHOR,
  decideStatusMove,
  historyDetails,
  sameRequest,
  requestNote,
  UPDATE_WINDOW_MS,
} from '../domain/customer-request.js';
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
/** The first status of every request industry's pipeline (saas, education, spa). */
const NEW_LEAD_STATUS = 'new_lead';
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
        if (memberRoleOf(viewer.role) === 'care') fields.careUserId = me;
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
  async upsertLead(
    ws: WorkspaceId,
    input: {
      phoneE164: string;
      sourceKey: string;
      displayName: string;
      firstUrl: string | null;
      renameFrom?: string;
    },
  ): Promise<{ contactId: string; created: boolean }> {
    return this.store.run(ws, async (tx) => {
      await tx.lock(`phone/${input.phoneE164}`);
      const now = new Date();
      const found = await tx.contacts.findByPhone(input.phoneE164);
      if (found) {
        const name = input.displayName.trim();
        // Repeated or racing captures from the same page leave one entry.
        const marker = input.firstUrl ?? input.sourceKey;
        const earlier = await tx.history.list(found.id, {
          type: 'contact.updated',
          order: 'desc',
          limit: 100,
        });
        const leadKnown = earlier.some(
          (h) =>
            (h.changes['lead'] as { to?: unknown } | undefined)?.to === marker &&
            h.data['channel'] === input.sourceKey,
        );
        const changes: Record<string, { from: unknown; to: unknown }> = leadKnown
          ? {}
          : { lead: { from: null, to: marker } };
        let current = found;
        if (input.renameFrom !== undefined && found.name === input.renameFrom && name) {
          // A placeholder an earlier capture generated gives way to the name the customer gave.
          current = { ...found, name, version: found.version + 1, updatedAt: now };
          if (!(await tx.contacts.update(current, found.version))) {
            throw new StaleVersionError('contact', current.version);
          }
          changes['name'] = { from: found.name, to: name };
          await tx.outbox(ws, {
            type: 'crm.contact.updated.v1',
            aggregateId: found.id,
            payload: event(ws, found.id, null, now, { fields: ['name'], phoneCaptured: false }),
          });
        }
        // The rename and the lead marker of one capture are one history entry (QA Mailisa B8).
        if (Object.keys(changes).length)
          await this.#record(tx, ws, current, 'contact.updated', changes, null, null, now, {
            channel: input.sourceKey,
          });
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
      // A request business's new lead starts at its "new" status, so the status strip counts it.
      const industry = (await this.workspaces.getById(ws)).industry;
      if (isRequestIndustry(industry)) {
        await tx.options.ensureDefaults(ws, 'status', defaultStatusesFor(industry));
        const fresh = (await tx.options.list('status')).find(
          (o) => o.key === NEW_LEAD_STATUS && !o.archivedAt,
        );
        if (fresh) fields.statusId = fresh.id;
      }
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
          statusId: contact.statusId,
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
      assertUnlocked(before, after);
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

  /**
   * Moves a customer to the built-in status `key` on behalf of the system (no staff actor), with
   * the same history entry and event as a staff change. `forwardOnly` keeps a customer already at
   * or past that status in the pipeline order; `keep` keeps a customer at one of these keys. An
   * unknown or archived status changes nothing. Returns whether the status changed. Throws
   * NOT_FOUND for an unknown customer.
   */
  async moveStatusByKey(
    ws: WorkspaceId,
    contactId: string,
    key: string,
    opts: { forwardOnly: boolean; keep?: readonly string[] },
  ): Promise<boolean> {
    const defaults = defaultStatusesFor((await this.workspaces.getById(ws)).industry);
    const move: RequestStatusMove = opts.forwardOnly
      ? { key, move: 'forward_only' }
      : { key, move: 'unless', keep: opts.keep ?? [] };
    return this.store.run(ws, async (tx) => {
      const before = await this.#contact(tx, contactId, { forUpdate: true });
      return (await this.#moveStatus(tx, ws, before, move, defaults, new Date())) !== null;
    });
  }

  /**
   * The write half of a bot-recorded request (ESV spec §5.1 step 9), in one transaction: locks the
   * customer; the same kind recorded within `UPDATE_WINDOW_MS` makes this an update; moves the
   * status per the profile; appends the `contact.request_recorded` / `contact.request_updated`
   * entry; adds the note signed `BOT_AUTHOR` (a repeat of the latest note is skipped). An exact
   * repeat of a request still in its window (a retried call) writes nothing.
   */
  async applyBotRequest(
    ws: WorkspaceId,
    contactId: string,
    input: {
      industry: string;
      profile: RequestProfile;
      kind: CustomerRequestKind;
      details: Readonly<Record<string, unknown>>;
      dateLabel: string | null;
    },
  ): Promise<{ updated: boolean }> {
    const defaults = defaultStatusesFor(input.industry);
    return this.store.run(ws, async (tx) => {
      const contact = await this.#contact(tx, contactId, { forUpdate: true });
      const now = new Date();
      const earlier = await tx.history.latestRequestEntry(
        contactId,
        input.kind,
        new Date(now.getTime() - UPDATE_WINDOW_MS),
      );
      const updated = earlier !== null;
      const body = requestNote(input.profile, input.kind, input.details, updated);
      const details = historyDetails(input.profile, input.details);
      // A retried call (or the same call twice in one turn): the latest request entry of this kind
      // already holds exactly these details. Notes are not compared: staff may add one in between.
      if (earlier && sameRequest(earlier.data, details, input.dateLabel)) return { updated };
      const [latestNote] = await tx.notes.list(contactId);
      const move = input.profile.status[input.kind];
      const moved = move ? await this.#moveStatus(tx, ws, contact, move, defaults, now) : null;
      await this.#record(
        tx,
        ws,
        moved ?? contact,
        updated ? 'contact.request_updated' : 'contact.request_recorded',
        {},
        null,
        BOT_AUTHOR,
        now,
        { kind: input.kind, details, dateLabel: input.dateLabel },
      );
      if (latestNote?.body !== body)
        await this.#systemNote(tx, ws, contactId, body, BOT_AUTHOR, now);
      return { updated };
    });
  }

  /**
   * A note written by the system (`authorName` says by whom, e.g. the bot). A repeat of the
   * customer's latest note is skipped, so a retried call leaves one note. Returns whether it was added.
   */
  async addSystemNote(
    ws: WorkspaceId,
    contactId: string,
    raw: unknown,
    authorName: string,
  ): Promise<boolean> {
    const { body } = CreateContactNoteRequest.parse(raw);
    return this.store.run(ws, async (tx) => {
      await this.#contact(tx, contactId, { forUpdate: true });
      const [latest] = await tx.notes.list(contactId);
      if (latest?.body === body) return false;
      await this.#systemNote(tx, ws, contactId, body, authorName, new Date());
      return true;
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

  /**
   * Applies a system status move (built-in key) to a locked customer: history entry and event, no
   * staff actor. Returns the updated record, or null when the status stays.
   */
  async #moveStatus(
    tx: CrmTx,
    ws: WorkspaceId,
    before: ContactRecord,
    move: RequestStatusMove,
    defaults: ReadonlyArray<{ key: string; name: string; color: string }>,
    now: Date,
  ): Promise<ContactRecord | null> {
    await tx.options.ensureDefaults(ws, 'status', defaults);
    const statuses = await tx.options.list('status');
    const target = statuses.find((s) => s.key === move.key && !s.archivedAt);
    if (!target || target.id === before.statusId) return null;
    const current = statuses.find((s) => s.id === before.statusId) ?? null;
    if (
      !decideStatusMove(move, current?.key ?? null, {
        current: current?.position ?? null,
        target: target.position,
      })
    )
      return null;
    const next = { ...before, statusId: target.id, version: before.version + 1, updatedAt: now };
    if (!(await tx.contacts.update(next, before.version))) {
      throw new StaleVersionError('contact', next.version);
    }
    await this.#record(
      tx,
      ws,
      next,
      'contact.status_changed',
      { statusId: { from: before.statusId, to: target.id } },
      null,
      null,
      now,
    );
    await tx.outbox(ws, {
      type: 'crm.contact.status_changed.v1',
      aggregateId: before.id,
      payload: event(ws, before.id, null, now, {
        fromStatusId: before.statusId,
        toStatusId: target.id,
      }),
    });
    return next;
  }

  async #systemNote(
    tx: CrmTx,
    ws: WorkspaceId,
    contactId: string,
    body: string,
    authorName: string,
    now: Date,
  ): Promise<void> {
    const note = {
      id: newId(),
      contactId,
      body,
      authorUserId: null,
      authorName,
      version: 1,
      createdAt: now,
      editedAt: null,
    };
    await tx.notes.insert(note);
    await this.#record(tx, ws, { id: contactId }, 'note.added', {}, null, authorName, now, {
      noteId: note.id,
      body,
    });
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

/** The common payload of a crm contact event. */
export function event(
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

/** A blank customer to apply fields to (create paths). */
export function emptyContact(
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
    externalSource: null,
    externalId: null,
    version: 1,
    createdByUserId: createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The link keys of a customer linked to Rapiz HQ (phone, email) belong to the platform (ADR-021
 * §3): staff may resend them unchanged (compared normalized) but not change them.
 */
function assertUnlocked(before: ContactRecord, after: ContactRecord): void {
  const locked = lockedFields(before.externalId ? before.externalSource : null);
  const key = { phone: 'phoneNormalized', email: 'emailNormalized' } as const;
  const changed = locked.filter((f) => (before[key[f]] ?? null) !== (after[key[f]] ?? null));
  if (changed.length) {
    throw new InvalidContactError(Object.fromEntries(changed.map((f) => [f, 'LINKED_READ_ONLY'])));
  }
}
