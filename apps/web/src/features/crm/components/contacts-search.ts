import type { ContactFilter, ContactSort } from '@agent-sales/contracts';

export const SORT_KEYS = [
  'createdAt_desc',
  'createdAt_asc',
  'updatedAt_desc',
  'name_asc',
  'name_desc',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** List state kept in the URL (shareable, survives back/forward). */
export interface ContactsSearch {
  q?: string | undefined;
  filter?: ContactFilter | undefined;
  /** The saved view the filter came from. */
  view?: string | undefined;
  sort?: SortKey | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  /** Customer open in the drawer. */
  contact?: string | undefined;
}

export function toSort(key: SortKey | undefined): ContactSort {
  const [field, dir] = (key ?? 'createdAt_desc').split('_') as [
    ContactSort[number]['field'],
    'asc' | 'desc',
  ];
  return [{ field, dir }];
}

export function fromSort(sort: ContactSort): SortKey {
  const first = sort[0];
  const key = `${first?.field ?? 'createdAt'}_${first?.dir ?? 'desc'}`;
  return (SORT_KEYS as readonly string[]).includes(key) ? (key as SortKey) : 'createdAt_desc';
}
