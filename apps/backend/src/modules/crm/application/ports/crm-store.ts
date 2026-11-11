import type { ContactFilter, ContactSort } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

import type { Task } from '../../domain/task.js';
import type { TagField } from '../../domain/tag-values.js';

/** Plain records the CRM use cases work with (one per table row). */
export interface ContactRecord {
  id: string;
  name: string | null;
  phone: string | null;
  phoneNormalized: string | null;
  email: string | null;
  emailNormalized: string | null;
  birthday: string | null;
  gender: 'male' | 'female' | 'other' | null;
  address: string | null;
  province: string | null;
  ward: string | null;
  phoneProvidedAt: Date | null;
  addressProvidedAt: Date | null;
  sourceId: string | null;
  firstSourceId: string | null;
  statusId: string | null;
  salesUserId: string | null;
  careUserId: string | null;
  adRef: string | null;
  profileNote: string;
  searchText: string;
  clientRequestId: string | null;
  /** PMS link (ADR-017); both null when not linked. Written only through `CrmTx.contactSync`. */
  externalSource: string | null;
  externalId: string | null;
  version: number;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NoteRecord {
  id: string;
  contactId: string;
  body: string;
  authorUserId: string | null;
  authorName: string | null;
  version: number;
  createdAt: Date;
  editedAt: Date | null;
}

export interface HistoryRecord {
  id: string;
  contactId: string;
  type: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  data: Record<string, unknown>;
  actorUserId: string | null;
  actorName: string | null;
  createdAt: Date;
}

/** A request entry with its customer, for the summary's open list. */
export interface OpenRequestRecord extends HistoryRecord {
  contactName: string | null;
  statusKey: string | null;
}

/** New requests of a period per kind and per the customer's current status (counts only). */
export interface RequestCountRow {
  kind: string;
  statusKey: string | null;
  statusName: string | null;
  count: number;
}

export type OptionKind = 'source' | 'status';

export interface OptionRecord {
  id: string;
  key: string | null;
  name: string;
  color: string;
  position: number;
  archivedAt: Date | null;
}

export interface TagRecord {
  id: string;
  name: string;
  color: string;
  type: 'classification' | 'attribute' | 'work';
  description: string;
  fields: TagField[];
  schemaVersion: number;
  isSystem: boolean;
  key: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  version: number;
  archivedAt: Date | null;
  updatedAt: Date;
}

export interface AssignmentRecord {
  id: string;
  tagId: string;
  tagType: string;
  scope: 'contact' | 'conversation';
  entityId: string;
  values: Record<string, unknown>;
  schemaVersion: number;
  assignedAt: Date;
  assignedByUserId: string | null;
  assignedByName: string | null;
  removedAt: Date | null;
  removedByUserId: string | null;
  removeReason: string | null;
  version: number;
}

/** One active tag on one entity, with what a chip needs. */
export interface TaggedEntity {
  entityId: string;
  tagId: string;
  tagName: string;
  tagColor: string;
}

export interface ViewRecord {
  id: string;
  ownerUserId: string;
  ownerName: string | null;
  name: string;
  visibility: 'private' | 'shared';
  q: string;
  filter: ContactFilter;
  sort: ContactSort;
  columns: string[];
  version: number;
  updatedAt: Date;
}

export interface ContactQuery {
  /** Folded search text. */
  q?: string | undefined;
  filter: ContactFilter;
  sort: ContactSort;
  /** For local-day date rules (created/updated on a day). */
  timezone: string;
  /** Only customers this user owns (Sales or CSKH) or nobody owns; null = all. */
  ownerScope: string | null;
  offset: number;
  limit: number;
}

export interface PolicyRecord {
  sourceId: string;
  enabled: boolean;
  candidates: Array<{ userId: string; weight: number }>;
  /** Customers handed out so far (drives the round robin). */
  cursor: number;
  version: number;
}

/** Which tasks a list or count covers (CRM-04). */
export interface TaskFilter {
  /** Only tasks assigned to this user or unassigned; null = every task. */
  assigneeScope: string | null;
  /** `overdue`: open with `due_at` before `now`. Absent: every status. */
  status?: 'open' | 'done' | 'overdue' | undefined;
  contactId?: string | undefined;
  conversationId?: string | undefined;
  /** For `overdue`. */
  now: Date;
}

/** An integration event for the outbox (written in the same transaction as the change). */
export interface CrmOutboxEvent {
  type: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/** Everything one use case reads and writes, inside one tenant transaction (RLS-scoped). */
export interface CrmTx {
  contacts: {
    insert(c: ContactRecord): Promise<void>;
    /** Writes when the stored version is `expectedVersion`; false when it moved on. */
    update(c: ContactRecord, expectedVersion: number): Promise<boolean>;
    find(id: string, opts?: { forUpdate?: boolean }): Promise<ContactRecord | null>;
    findByRequestId(requestId: string): Promise<ContactRecord | null>;
    /** Oldest customer with this E.164 phone, or null. */
    findByPhone(phoneNormalized: string): Promise<ContactRecord | null>;
    /** Oldest customer with this normalized email, or null. */
    findByEmail(emailNormalized: string): Promise<ContactRecord | null>;
    /** Remembers that `botId` answered a conversation of the customer; a repeat is a no-op. */
    recordBot(contactId: string, botId: string, at: Date): Promise<void>;
    query(q: ContactQuery): Promise<{ rows: ContactRecord[]; total: number }>;
    countOwnedBy(userId: string): Promise<{ sales: number; care: number }>;
    /** Display names by id (statistics drilldown); unknown ids are absent. */
    namesOf(ids: readonly string[]): Promise<Map<string, string | null>>;
    /** Moves the owner slot of every customer owned by `from`; returns the ids moved. */
    reassignOwner(
      role: 'sales' | 'care',
      from: string,
      to: string | null,
      at: Date,
    ): Promise<string[]>;
    /** Non-archived customers per status id (null = no status). */
    countByStatus(): Promise<{ statusId: string | null; count: number }[]>;
    /**
     * Non-archived customers created in `[since, until)`, counted per first source name (the
     * current source when no first source is recorded; null = none), most first.
     */
    createdBySource(q: {
      since: Date;
      until: Date;
    }): Promise<{ source: string | null; count: number }[]>;
  };
  notes: {
    list(contactId: string): Promise<NoteRecord[]>;
    find(id: string, opts?: { forUpdate?: boolean }): Promise<NoteRecord | null>;
    insert(n: NoteRecord): Promise<void>;
    update(n: NoteRecord): Promise<void>;
  };
  /**
   * PMS link and push columns of contacts (ADR-017). Lookups lock the row until the transaction
   * ends. KiotViet is the only source, so the push state carries no source of its own.
   */
  contactSync: {
    findByExternal(source: string, externalId: string): Promise<ContactRecord | null>;
    /** Oldest live (not archived), unlinked customer with this E.164 phone. */
    findUnlinkedByPhone(phoneNormalized: string): Promise<ContactRecord | null>;
    /** Oldest live, unlinked customer with this normalized email (Rapiz HQ adoption). */
    findUnlinkedByEmail(emailNormalized: string): Promise<ContactRecord | null>;
    /**
     * Sets (and clears the push state) or removes the link; the version is the caller's. Throws
     * ContactExternalLinkConflictError when the external id is on another customer.
     */
    setLink(contactId: string, link: { source: string; id: string } | null): Promise<void>;
    /**
     * Removes the links to these external ids (all of the source when null), bumping version and
     * `updatedAt`; with `detach` (the PMS deleted them) the push state becomes 'detached', so the
     * push never re-creates them. Returns the customers unlinked.
     */
    unlink(
      source: string,
      externalIds: readonly string[] | null,
      at: Date,
      detach: boolean,
    ): Promise<Array<{ id: string; externalId: string }>>;
    /** Null → 'pending' for up to `limit` eligible customers (SKIP LOCKED), oldest first. */
    claim(since: Date, limit: number, at: Date): Promise<ContactRecord[]>;
    /** 'pending' → 'failed' with the code; false when the customer was not pending. */
    markFailed(contactId: string, code: string): Promise<boolean>;
    /** 'pending' → null (claimed before `olderThan` when given); returns how many. */
    releasePending(olderThan?: Date): Promise<number>;
    /** 'pending' and 'failed' → null ('detached' stays); returns how many. */
    clearPushStates(): Promise<number>;
    /** 'failed' → null (the next claim takes them again); returns how many. */
    releaseFailed(): Promise<number>;
    /** The customer while it is claimed ('pending'), unlinked and live; null otherwise. */
    pendingPush(contactId: string): Promise<ContactRecord | null>;
    stalePending(since: Date, olderThan: Date, limit: number): Promise<string[]>;
    countLinked(source: string): Promise<number>;
    externalIdOf(source: string, contactId: string): Promise<string | null>;
  };
  tasks: {
    insert(workspaceId: WorkspaceId, t: Task): Promise<void>;
    find(id: string, opts?: { forUpdate?: boolean }): Promise<Task | null>;
    /** Writes when the stored version is `expectedVersion`; false when it moved on. */
    update(t: Task, expectedVersion: number): Promise<boolean>;
    /**
     * Open (and overdue, and unfiltered) lists come by due time, undated last, then oldest
     * first; done lists newest done first.
     */
    list(f: TaskFilter, page: { offset: number; limit: number }): Promise<Task[]>;
    /** Open tasks in the scope with `due_at` before `dueBefore`. */
    countOpenDueBefore(assigneeScope: string | null, dueBefore: Date): Promise<number>;
  };
  history: {
    add(h: HistoryRecord): Promise<void>;
    /** The customer's newest request entry (recorded or updated) of `kind` at or after `since`. */
    latestRequestEntry(contactId: string, kind: string, since: Date): Promise<HistoryRecord | null>;
    /** The customer's request entries, newest first. */
    requestEntries(contactId: string, limit: number): Promise<HistoryRecord[]>;
    /**
     * `contact.request_recorded` entries (updates left out) in `[since, until)` of live customers,
     * counted per kind and per the customer's current status.
     */
    requestCounts(since: Date, until: Date): Promise<RequestCountRow[]>;
    /**
     * The newest request entry of each live customer since `since`, kept only when the customer is
     * still at the target status of the entry's kind (`targets`), newest first.
     */
    openRequests(q: {
      since: Date;
      targets: ReadonlyArray<{ kind: string; statusKey: string }>;
      limit: number;
    }): Promise<OpenRequestRecord[]>;
    /** Many entries in few statements (bulk unlink). */
    addMany(h: readonly HistoryRecord[]): Promise<void>;
    list(
      contactId: string,
      f: {
        type?: string | undefined;
        from?: Date | undefined;
        to?: Date | undefined;
        order: 'asc' | 'desc';
        limit: number;
      },
    ): Promise<HistoryRecord[]>;
  };
  options: {
    /** Inserts the built-in options that are missing (by key); safe to call every time. */
    ensureDefaults(
      workspaceId: WorkspaceId,
      kind: OptionKind,
      defaults: ReadonlyArray<{ key: string; name: string; color: string }>,
    ): Promise<void>;
    list(kind: OptionKind): Promise<OptionRecord[]>;
    find(kind: OptionKind, id: string): Promise<OptionRecord | null>;
    insert(workspaceId: WorkspaceId, kind: OptionKind, o: OptionRecord): Promise<void>;
    update(kind: OptionKind, o: OptionRecord): Promise<void>;
  };
  tags: {
    ensureDefaults(
      workspaceId: WorkspaceId,
      defaults: ReadonlyArray<
        Omit<
          TagRecord,
          | 'id'
          | 'schemaVersion'
          | 'isSystem'
          | 'createdByUserId'
          | 'createdByName'
          | 'version'
          | 'archivedAt'
          | 'updatedAt'
        >
      >,
    ): Promise<void>;
    list(): Promise<Array<TagRecord & { activeCount: number }>>;
    find(id: string, opts?: { forUpdate?: boolean }): Promise<TagRecord | null>;
    /** Throws DuplicateTagNameError on a name clash with an active tag. */
    insert(workspaceId: WorkspaceId, t: TagRecord): Promise<void>;
    update(t: TagRecord): Promise<void>;
  };
  assignments: {
    listFor(
      scope: 'contact' | 'conversation',
      entityIds: string[],
      includeRemoved: boolean,
    ): Promise<AssignmentRecord[]>;
    findActive(
      tagId: string,
      scope: 'contact' | 'conversation',
      entityId: string,
    ): Promise<AssignmentRecord | null>;
    find(id: string, opts?: { forUpdate?: boolean }): Promise<AssignmentRecord | null>;
    /**
     * Active assignments of non-archived tags with the tag's chip, oldest first. Narrowed by
     * entity ids and/or tag ids; with neither, every active assignment of the scope.
     */
    activePairs(
      scope: 'contact' | 'conversation',
      filter: { entityIds?: readonly string[]; tagIds?: readonly string[] },
    ): Promise<TaggedEntity[]>;
    /** Returns false when an active one already exists (unique per tag and entity). */
    insert(workspaceId: WorkspaceId, a: AssignmentRecord): Promise<boolean>;
    update(a: AssignmentRecord): Promise<void>;
  };
  views: {
    /** Shared views and the caller's private ones. */
    list(userId: string): Promise<ViewRecord[]>;
    find(id: string, opts?: { forUpdate?: boolean }): Promise<ViewRecord | null>;
    insert(workspaceId: WorkspaceId, v: ViewRecord): Promise<void>;
    update(v: ViewRecord): Promise<void>;
    delete(id: string): Promise<void>;
  };
  policies: {
    list(): Promise<PolicyRecord[]>;
    find(sourceId: string, opts?: { forUpdate?: boolean }): Promise<PolicyRecord | null>;
    /** Saves when the stored version is `expectedVersion` (0 = none yet); the new version or null. */
    save(
      p: Pick<PolicyRecord, 'sourceId' | 'enabled' | 'candidates'>,
      expectedVersion: number,
    ): Promise<number | null>;
    /** One more customer handed out. */
    advance(sourceId: string): Promise<void>;
  };
  /** Serializes concurrent transactions on the same key until this one ends (advisory lock). */
  lock(key: string): Promise<void>;
  outbox(workspaceId: WorkspaceId, e: CrmOutboxEvent): Promise<void>;
}

export interface CrmStore {
  run<T>(workspaceId: WorkspaceId, fn: (tx: CrmTx) => Promise<T>): Promise<T>;
}

export const CRM_STORE = Symbol('CRM_STORE');
