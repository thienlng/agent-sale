import { Plus, UsersRound } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiClientError } from '@/lib/api-client';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useContacts } from '../api/crm';
import { contactLabel } from '../hooks/crm-errors';
import { useCrmLookups } from '../hooks/use-crm-lookups';
import { useVisibleContactColumns } from './contact-columns';
import { ContactCreateDialog } from './contact-create-dialog';
import { ContactSheet } from './contact-sheet';
import { OptionBadge } from './crm-badges';
import { type ContactsSearch, toSort } from './contacts-search';
import { ContactsToolbar } from './contacts-toolbar';

/** Customer list (CRM-01/02): search, typed filters, saved views, columns, drawer. */
export function ContactsList({
  search,
  onSearch,
}: {
  search: ContactsSearch;
  onSearch: (next: ContactsSearch) => void;
}) {
  const { t } = useTranslation();
  const lookups = useCrmLookups();
  const columns = useVisibleContactColumns();
  const [creating, setCreating] = useState(false);
  const page = search.page ?? 1;
  const pageSize = search.pageSize ?? 20;
  const contacts = useContacts({
    ...(search.q ? { q: search.q } : {}),
    ...(search.filter ? { filter: search.filter } : {}),
    sort: toSort(search.sort),
    page,
    pageSize,
  });
  const data = contacts.data;
  const rows = data?.data ?? [];
  const unavailable = contacts.error instanceof ApiClientError && contacts.error.status === 503;
  const filtered = Boolean(search.q || search.filter);

  // Any change of the query starts again from page 1; opening a customer keeps the page.
  const change = useCallback(
    (patch: Partial<ContactsSearch>) => {
      const keepPage = 'contact' in patch || 'page' in patch;
      onSearch({ ...search, ...patch, ...(keepPage ? {} : { page: 1 }) });
    },
    [search, onSearch],
  );
  const open = (id: string | undefined) => change({ contact: id });

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('crm.title')}</h1>
          {data ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {t('crm.summary', { count: data.total, formatted: formatNumber(data.total) })}
            </p>
          ) : null}
        </div>
        <Button size="lg" onClick={() => setCreating(true)}>
          <Plus />
          {t('crm.add')}
        </Button>
      </header>

      <ContactsToolbar search={search} onChange={change} lookups={lookups} />

      {/* Phones: cards. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {rows.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => open(c.id)}
              className="flex w-full flex-col gap-1 rounded-xl border bg-card p-3 text-left focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{contactLabel(c, t)}</span>
                <OptionBadge option={lookups.status(c.statusId)} />
              </span>
              <span className="truncate text-sm text-muted-foreground tabular-nums">
                {[c.phone, c.email].filter(Boolean).join(' · ') || '—'}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-xl border md:block">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {columns.map((c) => (
                  <TableHead key={c.id} className="text-xs font-medium text-muted-foreground">
                    {t(c.header)}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.isPending
                ? Array.from({ length: 6 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={columns.length}>
                        <Skeleton className="h-7" />
                      </TableCell>
                    </TableRow>
                  ))
                : rows.map((c) => (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      data-state={search.contact === c.id ? 'selected' : undefined}
                      onClick={() => open(c.id)}
                    >
                      {columns.map((col) => (
                        <TableCell key={col.id} className={cn('align-top', col.className)}>
                          {col.id === 'name' ? (
                            <button
                              type="button"
                              className="max-w-full truncate text-left font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                              onClick={(e) => {
                                e.stopPropagation();
                                open(c.id);
                              }}
                            >
                              {contactLabel(c, t)}
                            </button>
                          ) : (
                            col.cell(c, { t, lookups })
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
              {(data && !rows.length) || unavailable ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={columns.length}
                    className="py-16 text-center text-muted-foreground"
                  >
                    <UsersRound className="mx-auto mb-3 size-8 text-primary" aria-hidden />
                    {unavailable
                      ? t('crm.unavailable')
                      : filtered
                        ? t('crm.empty')
                        : t('crm.emptyStart')}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </div>
      {data && !rows.length && !unavailable ? (
        <p className="text-center text-sm text-muted-foreground md:hidden">
          {filtered ? t('crm.empty') : t('crm.emptyStart')}
        </p>
      ) : null}

      {data?.total ? (
        <Pager
          page={page}
          pageSize={pageSize}
          total={data.total}
          onChange={change}
          pageInfoKey="crm.pageInfo"
        />
      ) : null}

      <ContactCreateDialog
        open={creating}
        onOpenChange={setCreating}
        lookups={lookups}
        onCreated={(id) => open(id)}
      />
      <ContactSheet contactId={search.contact} onClose={() => open(undefined)} lookups={lookups} />
    </section>
  );
}
