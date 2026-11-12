import { Industry, type MembershipDto } from '@agent-sales/contracts';
import { useIsMutating } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight, LayoutGrid, List, Plus, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { BusinessAvatar } from '@/components/business-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useBusinessSwitch } from '@/hooks/use-business-switch';
import { formatDay, isoDate } from '@/lib/format';
import { setPreference, usePreferences } from '@/lib/preferences/preferences';
import { PREFERENCES, type PreferenceValues } from '@/lib/preferences/registry';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

import {
  CREATED_WITHIN,
  filterBusinesses,
  GALLERY_SORTS,
  type GallerySearch,
  industriesOf,
} from '../lib/business-gallery';
import { DeletedBusinesses } from './deleted-businesses';

const ALL = 'all';
const SKELETONS = 3;

type GalleryView = PreferenceValues['business_view'];
const VIEW_ICONS = { list: List, grid: LayoutGrid } satisfies Record<GalleryView, unknown>;

/** Columns of a list row: stacked under the name on phones, aligned columns from `md` up. */
const ROW_GRID =
  'grid grid-cols-[2.5rem_minmax(0,1fr)_1rem] items-center gap-x-3 gap-y-1.5 px-4 py-3 md:grid-cols-[2.5rem_minmax(0,1fr)_11rem_8rem_9rem_1rem] md:gap-x-4';

/**
 * Account layer: every business of the signed-in user as a list of rows (default) or a card grid,
 * filtered by name, creation time and industry; the view is a per-browser preference. Opening a
 * row or card enters that business's own management area.
 */
export function BusinessGallery({
  search,
  onSearch,
}: {
  search: GallerySearch;
  onSearch: (next: GallerySearch) => void;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const { busy, choose } = useBusinessSwitch();
  const mutations = useIsMutating();
  const view = usePreferences().business_view;
  const businesses = session?.memberships ?? [];
  const shown = filterBusinesses(businesses, search);
  const industries = industriesOf(businesses);
  // Every business of an account the user belongs to would repeat that account's name; only
  // businesses joined from someone else's account say whose they are.
  const ownAccounts = new Set(session?.accounts.map((a) => a.accountId));
  const filtered = Boolean(search.q || search.industry || search.created);
  const set = (patch: Partial<GallerySearch>) => onSearch({ ...search, ...patch });
  const industryLabel = (value: string) =>
    Industry.safeParse(value).success ? t(`industries.${value}`) : value;

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('business.gallery.title')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t('business.gallery.subtitle', { count: businesses.length })}
          </p>
        </div>
        <Button asChild>
          <Link to="/app/businesses/new">
            <Plus />
            {t('nav.newBusiness')}
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="search">
        <div className="relative min-w-56 flex-1 max-sm:order-[-2]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search.q ?? ''}
            onChange={(e) => set({ q: e.target.value || undefined })}
            placeholder={t('business.gallery.searchPlaceholder')}
            aria-label={t('business.gallery.searchLabel')}
            className="pl-8"
          />
        </div>
        <Select
          value={search.industry ?? ALL}
          onValueChange={(v) => set({ industry: v === ALL ? undefined : v })}
        >
          <SelectTrigger className="w-52 max-sm:grow" aria-label={t('business.gallery.industry')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('business.gallery.allIndustries')}</SelectItem>
            {industries.map((value) => (
              <SelectItem key={value} value={value}>
                {industryLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={search.created ?? ALL}
          onValueChange={(v) =>
            set({ created: v === ALL ? undefined : (v as GallerySearch['created']) })
          }
        >
          <SelectTrigger className="w-44 max-sm:grow" aria-label={t('business.gallery.created')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('business.gallery.createdAny')}</SelectItem>
            {CREATED_WITHIN.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`business.gallery.createdWithin.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={search.sort ?? 'newest'}
          onValueChange={(v) =>
            set({ sort: v === 'newest' ? undefined : (v as GallerySearch['sort']) })
          }
        >
          <SelectTrigger className="w-40 max-sm:grow" aria-label={t('business.gallery.sort')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GALLERY_SORTS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`business.gallery.sorts.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtered ? (
          <Button
            variant="ghost"
            onClick={() => onSearch(search.sort ? { sort: search.sort } : {})}
          >
            {t('business.gallery.clear')}
          </Button>
        ) : null}
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          value={view}
          aria-label={t('business.gallery.view')}
          onValueChange={(v) => v && setPreference('business_view', v as GalleryView)}
          className="ml-auto max-sm:order-[-1]"
        >
          {PREFERENCES.business_view.values.map((v) => {
            const Icon = VIEW_ICONS[v];
            return (
              <ToggleGroupItem
                key={v}
                value={v}
                aria-label={t(`business.gallery.views.${v}`)}
                title={t(`business.gallery.views.${v}`)}
              >
                <Icon />
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </div>

      {!session ? (
        <GallerySkeleton view={view} label={t('business.gallery.loading')} />
      ) : businesses.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t('analytics.overview.noBusinesses')}
        </p>
      ) : shown.length === 0 ? (
        <p
          role="status"
          className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground"
        >
          {t('business.noResults')}
        </p>
      ) : (
        <ul
          data-view={view}
          className={
            view === 'list'
              ? 'divide-y overflow-hidden rounded-xl border bg-card shadow-xs'
              : 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
          }
        >
          {shown.map((m) => {
            const Item = view === 'list' ? BusinessRow : BusinessCard;
            return (
              <li key={m.workspaceId}>
                <Item
                  business={m}
                  showAccount={!ownAccounts.has(m.accountId ?? '')}
                  industry={m.industry ? industryLabel(m.industry) : null}
                  disabled={busy || mutations > 0}
                  onOpen={() => void choose(m.workspaceId)}
                />
              </li>
            );
          })}
        </ul>
      )}

      <DeletedBusinesses />
    </section>
  );
}

interface BusinessItemProps {
  business: MembershipDto;
  showAccount: boolean;
  industry: string | null;
  disabled: boolean;
  onOpen: () => void;
}

/**
 * One business as a list row: the same click target as the card. From `md` up the badges and the
 * date sit in fixed-width columns so they line up across rows; on phones they wrap under the name.
 */
function BusinessRow({ business, showAccount, industry, disabled, onOpen }: BusinessItemProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      aria-label={t('business.gallery.open', { name: business.workspaceName })}
      className={cn(
        ROW_GRID,
        'group w-full text-left transition hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset disabled:opacity-60',
      )}
    >
      <BusinessAvatar
        workspaceId={business.workspaceId}
        logoVersion={business.logoVersion}
        icon={business.icon}
        className="row-span-2 size-10 self-start md:row-span-1 md:self-center"
      />
      <div className="min-w-0">
        <p className="truncate font-medium group-hover:text-brand-text">{business.workspaceName}</p>
        {showAccount && business.accountName ? (
          <p className="truncate text-xs text-muted-foreground">
            {t('business.gallery.otherAccount', { name: business.accountName })}
          </p>
        ) : null}
      </div>
      <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-1.5 md:contents">
        {industry ? (
          <Badge
            variant="secondary"
            className="max-w-full md:col-start-3 md:row-start-1 md:justify-self-start"
          >
            <span className="truncate">{industry}</span>
          </Badge>
        ) : null}
        <Badge variant="outline" className="md:col-start-4 md:row-start-1 md:justify-self-start">
          {t(`team.roles.${business.role}`, business.role)}
        </Badge>
        {business.createdAt ? (
          <span className="text-xs text-muted-foreground md:col-start-5 md:row-start-1">
            {t('business.gallery.createdOn', {
              date: formatDay(isoDate(new Date(business.createdAt))),
            })}
          </span>
        ) : null}
      </div>
      <ChevronRight
        aria-hidden
        className="col-start-3 row-span-2 row-start-1 size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground md:col-start-6 md:row-span-1"
      />
    </button>
  );
}

function GallerySkeleton({ view, label }: { view: GalleryView; label: string }) {
  const items = Array.from({ length: SKELETONS }, (_, i) => i);
  return (
    <div role="status" aria-label={label}>
      {view === 'list' ? (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {items.map((i) => (
            <div key={i} className={ROW_GRID}>
              <Skeleton className="row-span-2 size-10 self-start rounded-lg md:row-span-1 md:self-center" />
              <Skeleton className="h-4 w-40 max-w-full" />
              <div className="col-start-2 flex gap-1.5 md:contents">
                <Skeleton className="h-5 w-24 md:col-start-3 md:row-start-1" />
                <Skeleton className="h-5 w-16 md:col-start-4 md:row-start-1" />
                <Skeleton className="h-4 w-28 md:col-start-5 md:row-start-1" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {items.map((i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      )}
    </div>
  );
}

function BusinessCard({ business, showAccount, industry, disabled, onOpen }: BusinessItemProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      aria-label={t('business.gallery.open', { name: business.workspaceName })}
      className="group flex h-full w-full flex-col gap-4 rounded-xl border bg-card p-5 text-left shadow-xs transition hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-offset-3 focus-visible:ring-offset-background focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
    >
      <div className="flex items-start gap-3">
        <BusinessAvatar
          workspaceId={business.workspaceId}
          logoVersion={business.logoVersion}
          icon={business.icon}
          className="size-12 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold group-hover:text-brand-text">
            {business.workspaceName}
          </p>
          {showAccount && business.accountName ? (
            <p className="truncate text-sm text-muted-foreground">
              {t('business.gallery.otherAccount', { name: business.accountName })}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-auto flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {industry ? <Badge variant="secondary">{industry}</Badge> : null}
          <Badge variant="outline">{t(`team.roles.${business.role}`, business.role)}</Badge>
        </div>
        {business.createdAt ? (
          <p className="text-xs text-muted-foreground">
            {t('business.gallery.createdOn', {
              date: formatDay(isoDate(new Date(business.createdAt))),
            })}
          </p>
        ) : null}
      </div>
    </button>
  );
}
