import { DomainError, type WorkspaceId } from '@agent-sales/shared';

/**
 * A system a customer can be linked to: a PMS (`kiotviet`, ADR-017) or the Rapiz platform itself
 * (`rapiz`: a platform account in the Rapiz HQ workspace, ADR-021). Per-source rules:
 * `domain/external-contact.ts` (`EXTERNAL_SOURCE_RULES`).
 */
export type ContactExternalSource = 'kiotviet' | 'rapiz';

/** A customer as the PMS knows it (PMS-neutral). Raw values: the crm module normalizes them. */
export interface ExternalContactInput {
  externalId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  /** `YYYY-MM-DD`, or an ISO date-time whose date part is used. */
  birthday: string | null;
  gender: 'male' | 'female' | null;
}

export type UpsertExternalContactResult =
  | { contactId: string; created: boolean; matchedBy: 'external' | 'phone' | 'email' | 'new' }
  | { skipped: 'no_identity' };

/** What a push to the PMS needs of a claimed customer. */
export interface PushableContact {
  id: string;
  /** The customer's name, or the phone as typed when the customer has no name. */
  name: string;
  phoneE164: string;
  email: string | null;
  address: string | null;
}

/**
 * Customer sync with a PMS (ADR-017, spec §4.4; used by `integration`). The PMS owns a linked
 * customer's name, phone, email, address, birthday and gender: its changes overwrite them (history,
 * `crm.contact.updated.v1`, version bump). Everything else (notes, status, owners, tags) stays
 * Rapiz's. A link never locks the customer and an unlink never deletes it. Every call runs in one
 * tenant transaction; nothing here logs customer data.
 */
export interface ContactSyncFacade {
  /**
   * Match order: the external id; else the oldest live, unlinked customer with that normalized phone
   * (linked from now on); else, for `rapiz`, the oldest live, unlinked customer with that email;
   * else a new customer with the source's built-in source ("KiotViet", "Rapiz") (auto-assignment,
   * history and events as any create, no actor). A record without a usable name, phone or email is
   * skipped. An empty or oversized `externalId` throws InvalidExternalContactIdError (it is
   * trimmed otherwise). Serialized per phone with lead capture (`upsertLeadByPhone`) and per external id.
   */
  upsertExternalContact(
    ws: WorkspaceId,
    source: ContactExternalSource,
    c: ExternalContactInput,
  ): Promise<UpsertExternalContactResult>;
  /**
   * PMS deletes: the customers linked to these ids lose the link and stay, marked 'detached' so
   * `claimContactsForPush` never re-creates them in the PMS (a later import that links one again
   * clears the mark). Returns how many.
   */
  unlinkExternalContacts(
    ws: WorkspaceId,
    source: ContactExternalSource,
    externalIds: readonly string[],
  ): Promise<number>;
  /**
   * Atomically claims up to `limit` customers to create in the PMS (push state null → 'pending'):
   * unlinked, live, with a usable phone, created since `since`, oldest first. A claimed customer is
   * never returned again until released; a 'detached' one (deleted in the PMS) never.
   */
  claimContactsForPush(
    ws: WorkspaceId,
    source: ContactExternalSource,
    since: Date,
    limit: number,
  ): Promise<PushableContact[]>;
  /**
   * Links the customer to the PMS customer the push created and clears its push state. The same id
   * again is a no-op; another id throws ContactAlreadyLinkedError; an id already linked to another
   * customer throws ContactExternalLinkConflictError. NOT_FOUND for an unknown customer. Takes the
   * same external-id lock as `upsertExternalContact`, so a webhook import of the new PMS customer
   * racing this call finds the link instead of creating a second customer.
   */
  markContactPushed(
    ws: WorkspaceId,
    contactId: string,
    source: ContactExternalSource,
    externalId: string,
  ): Promise<void>;
  /**
   * What a push job needs of a claimed customer: null unless it is still `pending`, unlinked and
   * live (pushed, released, linked or archived meanwhile).
   */
  pushableContact(
    ws: WorkspaceId,
    source: ContactExternalSource,
    contactId: string,
  ): Promise<PushableContact | null>;
  /** 'pending' → 'failed' with an i18n error code (PII-free); any other state: no-op. */
  markContactPushFailed(ws: WorkspaceId, contactId: string, code: string): Promise<void>;
  /**
   * Disconnect or push turned off: `pending` claims go back to no push state; with `olderThan`,
   * only claims made before it (the sweep of claims nothing will push). Returns how many.
   */
  releasePendingContactPushes(
    ws: WorkspaceId,
    source: ContactExternalSource,
    olderThan?: Date,
  ): Promise<number>;
  /**
   * Failed pushes go back to no push state, so the next claim retries them (a full import, or the
   * owner turning the sync on again). Returns how many.
   */
  releaseFailedContactPushes(ws: WorkspaceId, source: ContactExternalSource): Promise<number>;
  /**
   * Customers still `pending`, live and with a usable phone, created since `since`, claimed before
   * `olderThan`, oldest claim first: the caller re-queues those its own queue lost (a crash between claim and enqueue).
   */
  staleContactPushes(
    ws: WorkspaceId,
    source: ContactExternalSource,
    since: Date,
    olderThan: Date,
    limit: number,
  ): Promise<string[]>;
  /**
   * Disconnect: every customer linked to the source is unlinked (data kept) and 'pending' /
   * 'failed' push states clear ('detached' stays).
   */
  releaseExternalSource(ws: WorkspaceId, source: ContactExternalSource): Promise<number>;
  linkedContactCount(ws: WorkspaceId, source: ContactExternalSource): Promise<number>;
  /** The PMS customer id of a Rapiz customer, if linked. */
  externalIdOf(
    ws: WorkspaceId,
    source: ContactExternalSource,
    contactId: string,
  ): Promise<string | null>;
}

export const CONTACT_SYNC_FACADE = Symbol('CONTACT_SYNC_FACADE');

/** The customer is already linked to another PMS customer; the first link is kept. */
export class ContactAlreadyLinkedError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('The customer is already linked to another PMS customer', { reason: 'ALREADY_LINKED' });
  }
}

/** The PMS customer is already linked to another Rapiz customer (unique `contacts_external`). */
export class ContactExternalLinkConflictError extends DomainError {
  readonly code = 'CONFLICT';
  constructor() {
    super('The PMS customer is already linked to another customer', {
      reason: 'EXTERNAL_CONTACT_LINK_RACE',
    });
  }
}

/** A PMS customer id must be non-empty and at most 64 characters (after trimming). */
export class InvalidExternalContactIdError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor() {
    super('The PMS customer id is empty or too long', { fields: { externalId: 'invalid' } });
  }
}
