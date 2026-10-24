import type {
  ContactDto,
  ContactHistoryEntry,
  ContactNoteDto,
  CrmOptionDto,
  SavedViewDto,
  TagAssignmentDto,
  TagDto,
} from '@agent-sales/contracts';
import { foldVietnamese } from '@agent-sales/shared';

import type {
  AssignmentRecord,
  ContactRecord,
  HistoryRecord,
  NoteRecord,
  OptionRecord,
  TagRecord,
  ViewRecord,
} from './ports/crm-store.js';

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** Folded name, phone (as typed and normalized, national form) and email for free-text search. */
export function contactSearchText(
  c: Pick<ContactRecord, 'name' | 'phone' | 'phoneNormalized' | 'email'>,
): string {
  const national = c.phoneNormalized?.startsWith('+84') ? `0${c.phoneNormalized.slice(3)}` : null;
  return foldVietnamese(
    [c.name, c.phone?.replace(/\D/g, ''), c.phoneNormalized, national, c.email]
      .filter(Boolean)
      .join(' '),
  );
}

export function toAssignmentDto(a: AssignmentRecord): TagAssignmentDto {
  return {
    id: a.id,
    tagId: a.tagId,
    scope: a.scope,
    entityId: a.entityId,
    values: a.values as TagAssignmentDto['values'],
    schemaVersion: a.schemaVersion,
    assignedAt: a.assignedAt.toISOString(),
    assignedByName: a.assignedByName,
    removedAt: iso(a.removedAt),
    version: a.version,
  };
}

export function toContactDto(c: ContactRecord, tags: AssignmentRecord[]): ContactDto {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    phoneNormalized: c.phoneNormalized,
    email: c.email,
    birthday: c.birthday,
    gender: c.gender,
    address: c.address,
    province: c.province,
    ward: c.ward,
    phoneProvidedAt: iso(c.phoneProvidedAt),
    addressProvidedAt: iso(c.addressProvidedAt),
    sourceId: c.sourceId,
    firstSourceId: c.firstSourceId,
    statusId: c.statusId,
    salesUserId: c.salesUserId,
    careUserId: c.careUserId,
    adRef: c.adRef,
    profileNote: c.profileNote,
    tags: tags.filter((t) => !t.removedAt).map(toAssignmentDto),
    version: c.version,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export const toNoteDto = (n: NoteRecord): ContactNoteDto => ({
  id: n.id,
  body: n.body,
  authorName: n.authorName,
  createdAt: n.createdAt.toISOString(),
  editedAt: iso(n.editedAt),
  version: n.version,
});

export const toHistoryDto = (h: HistoryRecord): ContactHistoryEntry => ({
  id: h.id,
  type: h.type as ContactHistoryEntry['type'],
  changes: h.changes,
  data: h.data,
  actorName: h.actorName,
  at: h.createdAt.toISOString(),
});

export const toOptionDto = (o: OptionRecord): CrmOptionDto => ({
  id: o.id,
  key: o.key,
  name: o.name,
  color: o.color,
  position: o.position,
  archived: o.archivedAt !== null,
});

export const toTagDto = (t: TagRecord, activeCount: number): TagDto => ({
  id: t.id,
  name: t.name,
  color: t.color,
  type: t.type,
  description: t.description,
  fields: t.fields,
  schemaVersion: t.schemaVersion,
  isSystem: t.isSystem,
  archived: t.archivedAt !== null,
  createdByName: t.createdByName,
  activeCount,
  version: t.version,
  updatedAt: t.updatedAt.toISOString(),
});

export const toViewDto = (v: ViewRecord, userId: string): SavedViewDto => ({
  id: v.id,
  name: v.name,
  visibility: v.visibility,
  isOwner: v.ownerUserId === userId,
  ownerName: v.ownerName,
  q: v.q,
  filter: v.filter,
  sort: v.sort,
  columns: v.columns,
  version: v.version,
  updatedAt: v.updatedAt.toISOString(),
});
