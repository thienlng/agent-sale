import type { ContactDto } from '@agent-sales/contracts';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';

import { formatDate, formatDateTime } from '@/lib/format';
import { storage } from '@/lib/storage';

import type { CrmLookups } from '../hooks/use-crm-lookups';
import { OptionBadge, TagChips } from './crm-badges';

export interface ContactColumn {
  id: string;
  /** i18n key of the header. */
  header: string;
  defaultVisible: boolean;
  /** Cannot be hidden or moved (identifies the row). */
  fixed?: boolean;
  className?: string;
  cell: (c: ContactDto, x: { t: TFunction; lookups: CrmLookups }) => ReactNode;
}

const dash = (v: string | null | undefined) => v || '—';

/** Every column the customer list can show (docs/02 CRM-01). */
export const CONTACT_COLUMNS: readonly ContactColumn[] = [
  {
    id: 'name',
    header: 'crm.col.name',
    defaultVisible: true,
    fixed: true,
    className: 'max-w-56',
    cell: (c, { t }) => (
      <span className="block truncate font-medium">{c.name || t('crm.noName')}</span>
    ),
  },
  {
    id: 'phone',
    header: 'crm.col.phone',
    defaultVisible: true,
    cell: (c) => <span className="tabular-nums">{dash(c.phone)}</span>,
  },
  {
    id: 'email',
    header: 'crm.col.email',
    defaultVisible: true,
    className: 'max-w-48',
    cell: (c) => <span className="block truncate">{dash(c.email)}</span>,
  },
  {
    id: 'source',
    header: 'crm.col.source',
    defaultVisible: true,
    cell: (c, { lookups }) => <OptionBadge option={lookups.source(c.sourceId)} />,
  },
  {
    id: 'status',
    header: 'crm.col.status',
    defaultVisible: true,
    cell: (c, { lookups }) => <OptionBadge option={lookups.status(c.statusId)} />,
  },
  {
    id: 'sales',
    header: 'crm.col.sales',
    defaultVisible: true,
    cell: (c, { lookups }) => dash(lookups.member(c.salesUserId)),
  },
  {
    id: 'care',
    header: 'crm.col.care',
    defaultVisible: false,
    cell: (c, { lookups }) => dash(lookups.member(c.careUserId)),
  },
  {
    id: 'tags',
    header: 'crm.col.tags',
    defaultVisible: true,
    className: 'max-w-60 whitespace-normal',
    cell: (c, { lookups }) => <TagChips assignments={c.tags} lookups={lookups} max={3} />,
  },
  {
    id: 'address',
    header: 'crm.col.address',
    defaultVisible: false,
    className: 'max-w-60 whitespace-normal',
    cell: (c) => (
      <span className="line-clamp-2 text-muted-foreground">
        {[c.address, c.ward, c.province].filter(Boolean).join(', ') || '—'}
      </span>
    ),
  },
  {
    id: 'adRef',
    header: 'crm.col.adRef',
    defaultVisible: false,
    cell: (c) => dash(c.adRef),
  },
  {
    id: 'profileNote',
    header: 'crm.col.profileNote',
    defaultVisible: false,
    className: 'max-w-56 whitespace-normal',
    cell: (c) => <span className="line-clamp-2 text-muted-foreground">{dash(c.profileNote)}</span>,
  },
  {
    id: 'birthday',
    header: 'crm.col.birthday',
    defaultVisible: false,
    cell: (c) => (c.birthday ? formatDate(c.birthday) : '—'),
  },
  {
    id: 'createdAt',
    header: 'crm.col.createdAt',
    defaultVisible: true,
    cell: (c) => (
      <span className="text-muted-foreground tabular-nums">{formatDateTime(c.createdAt)}</span>
    ),
  },
  {
    id: 'updatedAt',
    header: 'crm.col.updatedAt',
    defaultVisible: false,
    cell: (c) => (
      <span className="text-muted-foreground tabular-nums">{formatDateTime(c.updatedAt)}</span>
    ),
  },
];

const KEY = 'rapiz.crm.columns';
const DEFAULT_IDS = CONTACT_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);
const listeners = new Set<() => void>();
let cached: { raw: string | null; ids: string[] } | null = null;

/** Visible column ids in display order, per browser (a user preference, not shop data). */
function read(): string[] {
  const raw = storage.get(KEY);
  if (cached?.raw === raw) return cached.ids;
  let ids = DEFAULT_IDS;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      const known = new Set(CONTACT_COLUMNS.map((c) => c.id));
      ids = [
        'name',
        ...parsed.filter((x): x is string => typeof x === 'string' && known.has(x) && x !== 'name'),
      ];
    }
  } catch {
    // keep the defaults
  }
  cached = { raw, ids };
  return ids;
}

export function setContactColumns(ids: string[]): void {
  storage.set(KEY, JSON.stringify(ids));
  listeners.forEach((l) => l());
}

export function resetContactColumns(): void {
  storage.remove(KEY);
  listeners.forEach((l) => l());
}

export function useContactColumnIds(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => DEFAULT_IDS,
  );
}

export function useVisibleContactColumns(): ContactColumn[] {
  const ids = useContactColumnIds();
  return ids.flatMap((id) => CONTACT_COLUMNS.filter((c) => c.id === id));
}
