import { isUuid, newId, normalizeAnyPhone, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import {
  ContactAlreadyLinkedError,
  type ContactExternalSource,
  type ContactSyncFacade,
  type ExternalContactInput,
  InvalidExternalContactIdError,
  type PushableContact,
  type UpsertExternalContactResult,
} from '../api/contact-sync.facade.js';
import { ContactNotFoundError } from '../domain/crm.errors.js';
import { DEFAULT_SOURCES, KIOTVIET_SOURCE } from '../domain/crm-defaults.js';
import {
  cleanExternalContact,
  type ExternalContactFields,
  externalPatch,
  normalizeExternalId,
  rejectedFields,
} from '../domain/external-contact.js';
import { applyFields } from './contact-fields.js';
import { emptyContact, event } from './contact.service.js';
import { diff } from './crm-rules.js';
import { DistributionService } from './distribution.service.js';
import { CRM_STORE, type ContactRecord, type CrmStore, type CrmTx } from './ports/crm-store.js';

type Changes = Record<string, { from: unknown; to: unknown }>;

/** The history key of a link change (the web labels it `crm.col.external`). */
const LINK = 'external';

/**
 * Customer sync with a PMS (ADR-017, spec §4.4): the PMS owns a linked customer's profile fields;
 * Rapiz keeps notes, status, owners and tags. Never logs customer data.
 */
@Injectable()
export class ContactSyncService implements ContactSyncFacade {
  constructor(
    @Inject(CRM_STORE) private readonly store: CrmStore,
    @Inject(DistributionService) private readonly distribution: DistributionService,
  ) {}

  upsertExternalContact(
    ws: WorkspaceId,
    source: ContactExternalSource,
    input: ExternalContactInput,
  ): Promise<UpsertExternalContactResult> {
    const externalId = normalizeExternalId(input.externalId);
    if (!externalId) return Promise.reject(new InvalidExternalContactIdError());
    const fields = cleanExternalContact(input);
    if (!fields) return Promise.resolve({ skipped: 'no_identity' });
    const rejected = rejectedFields(input, fields);
    const phoneE164 = fields.phone ? normalizeAnyPhone(fields.phone) : null;
    return this.store.run(ws, async (tx) => {
      // Fixed order (external id, then phone) so two imports never wait on each other in a cycle;
      // the phone lock is the one lead capture (`upsertLead`) takes.
      await tx.lock(`external/${source}/${externalId}`);
      if (phoneE164) await tx.lock(`phone/${phoneE164}`);
      const now = new Date();
      const linked = await tx.contactSync.findByExternal(source, externalId);
      if (linked) {
        await this.#update(tx, ws, linked, externalPatch(fields, 'linked', rejected), null, now);
        return { contactId: linked.id, created: false, matchedBy: 'external' };
      }
      const byPhone = phoneE164 ? await tx.contactSync.findUnlinkedByPhone(phoneE164) : null;
      const link = { source, id: externalId };
      if (byPhone) {
        await this.#update(tx, ws, byPhone, externalPatch(fields, 'adopt'), link, now);
        return { contactId: byPhone.id, created: false, matchedBy: 'phone' };
      }
      const contactId = await this.#create(tx, ws, fields, link, now);
      return { contactId, created: true, matchedBy: 'new' };
    });
  }

  unlinkExternalContacts(
    ws: WorkspaceId,
    source: ContactExternalSource,
    externalIds: readonly string[],
  ): Promise<number> {
    const ids = externalIds.map(normalizeExternalId).filter((x): x is string => x !== null);
    if (!ids.length) return Promise.resolve(0);
    return this.store.run(ws, (tx) => this.#unlink(tx, ws, source, ids, 'external_deleted'));
  }

  claimContactsForPush(
    ws: WorkspaceId,
    _source: ContactExternalSource,
    since: Date,
    limit: number,
  ): Promise<PushableContact[]> {
    return this.store.run(ws, async (tx) => {
      const rows = await tx.contactSync.claim(since, Math.max(0, Math.trunc(limit)), new Date());
      return rows.map(pushable);
    });
  }

  pushableContact(
    ws: WorkspaceId,
    _source: ContactExternalSource,
    contactId: string,
  ): Promise<PushableContact | null> {
    if (!isUuid(contactId)) return Promise.resolve(null);
    return this.store.run(ws, async (tx) => {
      const c = await tx.contactSync.pendingPush(contactId);
      return c?.phoneNormalized ? pushable(c) : null;
    });
  }

  markContactPushed(
    ws: WorkspaceId,
    contactId: string,
    source: ContactExternalSource,
    rawExternalId: string,
  ): Promise<void> {
    const externalId = normalizeExternalId(rawExternalId);
    if (!externalId) return Promise.reject(new InvalidExternalContactIdError());
    return this.store.run(ws, async (tx) => {
      // Before the row lock, in the upsert's order: a webhook import of this PMS customer waits
      // for the link (and then matches by external id) instead of creating a second customer.
      await tx.lock(`external/${source}/${externalId}`);
      const c = isUuid(contactId) ? await tx.contacts.find(contactId, { forUpdate: true }) : null;
      if (!c) throw new ContactNotFoundError(contactId);
      if (c.externalSource === source && c.externalId === externalId) return;
      if (c.externalId) throw new ContactAlreadyLinkedError();
      await this.#update(tx, ws, c, {}, { source, id: externalId }, new Date());
    });
  }

  markContactPushFailed(ws: WorkspaceId, contactId: string, code: string): Promise<void> {
    if (!isUuid(contactId)) return Promise.resolve();
    return this.store.run(ws, async (tx) => {
      await tx.contactSync.markFailed(contactId, code);
    });
  }

  releasePendingContactPushes(
    ws: WorkspaceId,
    _source: ContactExternalSource,
    olderThan?: Date,
  ): Promise<number> {
    return this.store.run(ws, (tx) => tx.contactSync.releasePending(olderThan));
  }

  releaseFailedContactPushes(ws: WorkspaceId, _source: ContactExternalSource): Promise<number> {
    return this.store.run(ws, (tx) => tx.contactSync.releaseFailed());
  }

  staleContactPushes(
    ws: WorkspaceId,
    _source: ContactExternalSource,
    since: Date,
    olderThan: Date,
    limit: number,
  ): Promise<string[]> {
    return this.store.run(ws, (tx) =>
      tx.contactSync.stalePending(since, olderThan, Math.max(0, Math.trunc(limit))),
    );
  }

  releaseExternalSource(ws: WorkspaceId, source: ContactExternalSource): Promise<number> {
    return this.store.run(ws, async (tx) => {
      await tx.contactSync.clearPushStates();
      return this.#unlink(tx, ws, source, null, 'disconnected');
    });
  }

  linkedContactCount(ws: WorkspaceId, source: ContactExternalSource): Promise<number> {
    return this.store.run(ws, (tx) => tx.contactSync.countLinked(source));
  }

  externalIdOf(
    ws: WorkspaceId,
    source: ContactExternalSource,
    contactId: string,
  ): Promise<string | null> {
    if (!isUuid(contactId)) return Promise.resolve(null);
    return this.store.run(ws, (tx) => tx.contactSync.externalIdOf(source, contactId));
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  /**
   * Writes the PMS fields that changed and, when given, the new link: one version bump, one
   * history entry, and `crm.contact.updated.v1` when a profile field changed. Nothing changed:
   * nothing written.
   */
  async #update(
    tx: CrmTx,
    ws: WorkspaceId,
    before: ContactRecord,
    patch: Partial<ExternalContactFields>,
    link: { source: string; id: string } | null,
    now: Date,
  ): Promise<void> {
    // The same number written differently (`0912…` vs `+84912…`) is no change.
    const same =
      patch.phone && before.phoneNormalized === normalizeAnyPhone(patch.phone)
        ? { phone: undefined }
        : {};
    const after = applyFields(before, { ...patch, ...same }, now);
    const changes: Changes = diff(before, after);
    const fields = Object.keys(changes);
    if (link) changes[LINK] = { from: before.externalSource, to: link.source };
    if (!Object.keys(changes).length) return;
    const next = { ...after, version: before.version + 1, updatedAt: now };
    // The row is locked (FOR UPDATE), so the version cannot have moved on.
    await tx.contacts.update(next, before.version);
    if (link) await tx.contactSync.setLink(before.id, link);
    await tx.history.add(
      history(before.id, 'contact.updated', changes, now, {
        external: link?.source ?? before.externalSource,
      }),
    );
    if (fields.length) {
      await tx.outbox(ws, {
        type: 'crm.contact.updated.v1',
        aggregateId: before.id,
        payload: event(ws, before.id, null, now, {
          fields,
          phoneCaptured: before.phoneProvidedAt === null && next.phoneProvidedAt !== null,
        }),
      });
    }
  }

  /** A new customer from the PMS: source "KiotViet", auto-assignment, history and events, no actor. */
  async #create(
    tx: CrmTx,
    ws: WorkspaceId,
    fields: ExternalContactFields,
    link: { source: string; id: string },
    now: Date,
  ): Promise<string> {
    await tx.options.ensureDefaults(ws, 'source', [...DEFAULT_SOURCES, KIOTVIET_SOURCE]);
    const source = (await tx.options.list('source')).find((o) => o.key === KIOTVIET_SOURCE.key);
    const autoSales = source ? await this.distribution.pick(tx, ws, source.id) : null;
    const empty = emptyContact(null, now);
    const contact: ContactRecord = {
      ...applyFields(
        empty,
        {
          ...externalPatch(fields, 'adopt'),
          ...(source ? { sourceId: source.id } : {}),
          ...(autoSales ? { salesUserId: autoSales } : {}),
        },
        now,
      ),
      externalSource: link.source,
      externalId: link.id,
    };
    await tx.contacts.insert(contact);
    await tx.history.add(
      history(
        contact.id,
        'contact.created',
        { ...diff(empty, contact), [LINK]: { from: null, to: link.source } },
        now,
        { external: link.source, ...(autoSales ? { autoAssigned: true } : {}) },
      ),
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
        origin: 'import',
        phoneCaptured: contact.phoneProvidedAt !== null,
        statusId: null,
      }),
    });
    return contact.id;
  }

  /** Unlinks (all of the source when `externalIds` is null) with one history entry per customer. */
  async #unlink(
    tx: CrmTx,
    _ws: WorkspaceId,
    source: string,
    externalIds: readonly string[] | null,
    reason: 'external_deleted' | 'disconnected',
  ): Promise<number> {
    const now = new Date();
    const unlinked = await tx.contactSync.unlink(source, externalIds, now);
    await tx.history.addMany(
      unlinked.map((u) =>
        history(u.id, 'contact.updated', { [LINK]: { from: source, to: null } }, now, {
          external: source,
          reason,
        }),
      ),
    );
    return unlinked.length;
  }
}

function pushable(c: ContactRecord): PushableContact {
  return {
    id: c.id,
    // A customer may have only a phone; the PMS needs a name.
    name: c.name ?? c.phone ?? c.phoneNormalized ?? '',
    phoneE164: c.phoneNormalized ?? '',
    email: c.email,
    address: c.address,
  };
}

function history(
  contactId: string,
  type: string,
  changes: Changes,
  at: Date,
  data: Record<string, unknown>,
) {
  return {
    id: newId(),
    contactId,
    type,
    changes,
    data,
    actorUserId: null,
    actorName: null,
    createdAt: at,
  };
}
