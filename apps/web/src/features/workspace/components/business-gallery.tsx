import { Industry, type MembershipDto } from '@agent-sales/contracts';
import { useIsMutating } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Plus, Search } from 'lucide-react';
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
import { useBusinessSwitch } from '@/hooks/use-business-switch';
import { formatDay, isoDate } from '@/lib/format';
import { useSession } from '@/lib/session';

import {
  CREATED_WITHIN,
  filterBusinesses,
  GALLERY_SORTS,
  type GallerySearch,
  industriesOf,
} from '../lib/business-gallery';

const ALL = 'all';

/**
 * Account layer: every business of the signed-in user as a card grid, filtered by name, creation
 * time and industry. Opening a card enters that business's own management area.
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
        <div className="relative min-w-56 flex-1">
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
          <SelectTrigger className="w-52" aria-label={t('business.gallery.industry')}>
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
          <SelectTrigger className="w-44" aria-label={t('business.gallery.created')}>
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
          <SelectTrigger className="w-40" aria-label={t('business.gallery.sort')}>
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
      </div>

      {businesses.length === 0 ? (
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
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((m) => (
            <li key={m.workspaceId}>
              <BusinessCard
                business={m}
                showAccount={!ownAccounts.has(m.accountId ?? '')}
                industry={m.industry ? industryLabel(m.industry) : null}
                disabled={busy || mutations > 0}
                onOpen={() => void choose(m.workspaceId)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BusinessCard({
  business,
  showAccount,
  industry,
  disabled,
  onOpen,
}: {
  business: MembershipDto;
  showAccount: boolean;
  industry: string | null;
  disabled: boolean;
  onOpen: () => void;
}) {
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
