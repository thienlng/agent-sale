import type { ContactFilter, SavedViewDto } from '@agent-sales/contracts';
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  ChevronDown,
  Columns3,
  ListFilter,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useSavedViews, useViewMutations } from '../api/crm';
import { crmErrorMessage } from '../hooks/crm-errors';
import type { CrmLookups } from '../hooks/use-crm-lookups';
import {
  CONTACT_COLUMNS,
  resetContactColumns,
  setContactColumns,
  useContactColumnIds,
} from './contact-columns';
import { type ContactsSearch, fromSort, SORT_KEYS, type SortKey, toSort } from './contacts-search';
import { EMPTY_FILTER, FilterBuilder } from './filter-builder';
import { SaveViewDialog } from './save-view-dialog';

const ALL = '__all';

function ColumnsMenu() {
  const { t } = useTranslation();
  const ids = useContactColumnIds();
  const move = (id: string, by: -1 | 1) => {
    const i = ids.indexOf(id);
    const j = i + by;
    if (i < 1 || j < 1 || j >= ids.length) return;
    const next = [...ids];
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    setContactColumns(next);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <Columns3 />
          <span className="hidden sm:inline">{t('crm.columns.title')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t('crm.columns.title')}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {[
          ...ids.flatMap((id) => CONTACT_COLUMNS.filter((c) => c.id === id)),
          ...CONTACT_COLUMNS.filter((c) => !ids.includes(c.id)),
        ]
          .filter((c) => !c.fixed)
          .map((c) => {
            const on = ids.includes(c.id);
            return (
              <div key={c.id} className="flex items-center gap-1 pr-1">
                <DropdownMenuCheckboxItem
                  className="flex-1"
                  checked={on}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() =>
                    setContactColumns(on ? ids.filter((x) => x !== c.id) : [...ids, c.id])
                  }
                >
                  {t(c.header)}
                </DropdownMenuCheckboxItem>
                {on ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t(c.header)}: ${t('crm.columns.up')}`}
                      onClick={() => move(c.id, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t(c.header)}: ${t('crm.columns.down')}`}
                      onClick={() => move(c.id, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </>
                ) : null}
              </div>
            );
          })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={resetContactColumns}>{t('crm.columns.reset')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ViewsMenu({
  search,
  views,
  onPick,
}: {
  search: ContactsSearch;
  views: SavedViewDto[];
  onPick: (v: SavedViewDto | null) => void;
}) {
  const { t } = useTranslation();
  const { update, remove } = useViewMutations();
  const current = views.find((v) => v.id === search.view);
  const mine = views.filter((v) => v.isOwner);
  const shared = views.filter((v) => !v.isOwner);
  const columns = useContactColumnIds();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 max-w-56 justify-between gap-2 font-normal">
          <Bookmark className="text-muted-foreground" />
          <span className="truncate font-medium">{current?.name ?? t('crm.views.all')}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuRadioGroup
          value={current?.id ?? ALL}
          onValueChange={(id) => onPick(views.find((v) => v.id === id) ?? null)}
        >
          <DropdownMenuRadioItem value={ALL}>{t('crm.views.all')}</DropdownMenuRadioItem>
          {mine.length ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t('crm.views.mine')}
              </DropdownMenuLabel>
              {mine.map((v) => (
                <DropdownMenuRadioItem key={v.id} value={v.id}>
                  <span className="truncate">{v.name}</span>
                  {v.visibility === 'shared' ? (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {t('crm.views.shared')}
                    </span>
                  ) : null}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          ) : null}
          {shared.length ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t('crm.views.shared')}
              </DropdownMenuLabel>
              {shared.map((v) => (
                <DropdownMenuRadioItem key={v.id} value={v.id}>
                  <span className="truncate">{v.name}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">
                    {t('crm.views.by', { name: v.ownerName ?? '—' })}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          ) : null}
        </DropdownMenuRadioGroup>
        {current?.isOwner ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                update.mutate(
                  {
                    id: current.id,
                    body: {
                      q: search.q ?? '',
                      filter: search.filter ?? EMPTY_FILTER,
                      sort: toSort(search.sort),
                      columns,
                      expectedVersion: current.version,
                    },
                  },
                  {
                    onSuccess: () => toast.success(t('crm.views.updated')),
                    onError: (err) => toast.error(crmErrorMessage(t, err)),
                  },
                )
              }
            >
              {t('crm.views.update')}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onSelect={() =>
                remove.mutate(current.id, {
                  onSuccess: () => {
                    toast.success(t('crm.views.deleted'));
                    onPick(null);
                  },
                  onError: (err) => toast.error(crmErrorMessage(t, err)),
                })
              }
            >
              <Trash2 />
              {t('crm.views.delete')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Search, saved views, filter builder, sort and columns, in one row. */
export function ContactsToolbar({
  search,
  onChange,
  lookups,
}: {
  search: ContactsSearch;
  onChange: (patch: Partial<ContactsSearch>) => void;
  lookups: CrmLookups;
}) {
  const { t } = useTranslation();
  const views = useSavedViews().data ?? [];
  const { create } = useViewMutations();
  const columns = useContactColumnIds();
  const [text, setText] = useState(search.q ?? '');
  const [filterOpen, setFilterOpen] = useState(false);
  const [saving, setSaving] = useState<ContactFilter | null>(null);
  const filter = search.filter ?? EMPTY_FILTER;
  const active = filter.rules.length + (filter.duplicatesOnly ? 1 : 0);

  // Follow the URL when it changes from outside, push typing to it debounced.
  const pushed = useRef(search.q ?? '');
  useEffect(() => {
    if ((search.q ?? '') !== pushed.current) {
      pushed.current = search.q ?? '';
      setText(search.q ?? '');
    }
  }, [search.q]);
  useEffect(() => {
    const id = setTimeout(() => {
      if ((search.q ?? '') !== text) {
        pushed.current = text;
        onChange({ q: text || undefined });
      }
    }, 300);
    return () => clearTimeout(id);
  }, [text, search.q, onChange]);

  const pickView = (v: SavedViewDto | null) => {
    if (!v) {
      onChange({ view: undefined, filter: undefined, q: undefined, sort: undefined });
      return;
    }
    if (v.columns.length) setContactColumns(v.columns);
    onChange({ view: v.id, filter: v.filter, q: v.q || undefined, sort: fromSort(v.sort) });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('crm.search')}
          aria-label={t('crm.search')}
          className="h-9 pl-9"
        />
      </div>

      <ViewsMenu search={search} views={views} onPick={pickView} />

      <Popover open={filterOpen} onOpenChange={setFilterOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9 gap-2 font-normal">
            <ListFilter className="text-muted-foreground" />
            {t('crm.filter.button')}
            {active ? (
              <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground tabular-nums">
                {active}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(44rem,calc(100vw-2rem))]">
          <FilterBuilder
            // Re-seeded from the URL each time the panel opens.
            key={filterOpen ? JSON.stringify(filter) : 'closed'}
            initial={filter}
            lookups={lookups}
            onApply={(f) => {
              onChange({ filter: f.rules.length || f.duplicatesOnly ? f : undefined });
              setFilterOpen(false);
            }}
            onSaveView={(f) => {
              setSaving(f);
              setFilterOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>

      <Select
        value={search.sort ?? 'createdAt_desc'}
        onValueChange={(v) => onChange({ sort: v as SortKey })}
      >
        <SelectTrigger className="h-9 w-40" aria-label={t('crm.sort.label')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_KEYS.map((k) => (
            <SelectItem key={k} value={k}>
              {t(`crm.sort.${k}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="ml-auto">
        <ColumnsMenu />
      </div>

      <SaveViewDialog
        open={saving !== null}
        onOpenChange={(o) => !o && setSaving(null)}
        pending={create.isPending}
        onSave={({ name, visibility }) =>
          create.mutate(
            {
              name,
              visibility,
              q: search.q ?? '',
              filter: saving ?? filter,
              sort: toSort(search.sort),
              columns,
            },
            {
              onSuccess: (v) => {
                toast.success(t('crm.views.saved', { name: v.name }));
                setSaving(null);
                onChange({ view: v.id, filter: v.filter });
              },
              onError: (err) => toast.error(crmErrorMessage(t, err)),
            },
          )
        }
      />
    </div>
  );
}
