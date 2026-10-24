import type { ContactFilter, ContactSort } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

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
    query(q: ContactQuery): Promise<{ rows: ContactRecord[]; total: number }>;
    countOwnedBy(userId: string): Promise<{ sales: number; care: number }>;
    /** Moves the owner slot of every customer owned by `from`; returns the ids moved. */
    reassignOwner(
      role: 'sales' | 'care',
      from: string,
      to: string | null,
      at: Date,
    ): Promise<string[]>;
  };
  notes: {
    list(contactId: string): Promise<NoteRecord[]>;
    find(id: string, opts?: { forUpdate?: boolean }): Promise<NoteRecord | null>;
    insert(n: NoteRecord): Promise<void>;
    update(n: NoteRecord): Promise<void>;
  };
  history: {
    add(h: HistoryRecord): Promise<void>;
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
  outbox(workspaceId: WorkspaceId, e: CrmOutboxEvent): Promise<void>;
}

export interface CrmStore {
  run<T>(workspaceId: WorkspaceId, fn: (tx: CrmTx) => Promise<T>): Promise<T>;
}

export const CRM_STORE = Symbol('CRM_STORE');
