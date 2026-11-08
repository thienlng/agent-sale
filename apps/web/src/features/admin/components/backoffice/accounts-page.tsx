import { ACCOUNT_STATUSES, SUBSCRIPTION_STATUSES } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatNumber } from '@/lib/format';

import { type AccountFilters, useAdminAccounts, useAdminPlans } from '../../api/backoffice';
import { PageHeader } from './page-header';
import { AccountStatusBadge, SubscriptionBadge } from './status-badges';

const ALL = '__all';
const ENDING = [7, 14, 30] as const;

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string | undefined) => void;
}) {
  const { t } = useTranslation('backoffice');
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger id={id} aria-label={label} className="w-44">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>
          {label}: {t('common.all')}
        </SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Every account with owner, plan and status; filters and search run on the server. */
export function AccountsPage() {
  const { t } = useTranslation('backoffice');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<AccountFilters>({});
  const plans = useAdminPlans();

  // Search after the operator pauses typing, not on every key.
  useEffect(() => {
    const id = setTimeout(() => {
      const q = search.trim() || undefined;
      setFilters((f) => (f.q === q ? f : { ...f, q }));
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const accounts = useAdminAccounts(filters);
  const rows = accounts.data?.pages.flatMap((p) => p.data) ?? [];
  const planCodes = [...new Map((plans.data ?? []).map((p) => [p.code, p.name])).entries()];

  return (
    <div className="flex w-full flex-col gap-6">
      <PageHeader title={t('accounts.title')} subtitle={t('accounts.subtitle')} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('accounts.search')}
            aria-label={t('accounts.search')}
            className="pl-9"
            maxLength={100}
          />
        </div>
        <FilterSelect
          id="f-status"
          label={t('accounts.status')}
          value={filters.status}
          options={ACCOUNT_STATUSES.map((s) => ({ value: s, label: t(`accountStatus.${s}`) }))}
          onChange={(v) => setFilters({ ...filters, status: v as AccountFilters['status'] })}
        />
        <FilterSelect
          id="f-sub"
          label={t('accounts.subStatus')}
          value={filters.subscriptionStatus}
          options={SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: t(`subStatus.${s}`) }))}
          onChange={(v) =>
            setFilters({
              ...filters,
              subscriptionStatus: v as AccountFilters['subscriptionStatus'],
            })
          }
        />
        <FilterSelect
          id="f-plan"
          label={t('accounts.plan')}
          value={filters.planCode}
          options={planCodes.map(([value, label]) => ({ value, label }))}
          onChange={(v) => setFilters({ ...filters, planCode: v })}
        />
        <FilterSelect
          id="f-ending"
          label={t('accounts.endingWithin')}
          value={filters.endingWithinDays?.toString()}
          options={ENDING.map((d) => ({
            value: String(d),
            label: t('accounts.endingWithinDays', { count: d }),
          }))}
          onChange={(v) => setFilters({ ...filters, endingWithinDays: v ? Number(v) : undefined })}
        />
      </div>

      {accounts.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : accounts.isError ? (
        <div className="flex items-center gap-3 text-sm text-destructive">
          {t('common.loadError')}
          <Button size="sm" variant="outline" onClick={() => void accounts.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t('accounts.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('accounts.account')}</TableHead>
                <TableHead>{t('accounts.owner')}</TableHead>
                <TableHead>{t('accounts.plan')}</TableHead>
                <TableHead>{t('accounts.subStatus')}</TableHead>
                <TableHead>{t('accounts.periodEnd')}</TableHead>
                <TableHead className="text-right">{t('accounts.businesses')}</TableHead>
                <TableHead>{t('accounts.createdAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="max-w-64">
                    <Link
                      to="/admin/accounts/$accountId"
                      params={{ accountId: a.id }}
                      className="block truncate font-medium hover:underline"
                    >
                      {a.name}
                    </Link>
                    {a.status === 'active' ? null : <AccountStatusBadge status={a.status} />}
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground">
                    {a.owner?.email ?? t('common.none')}
                  </TableCell>
                  <TableCell>{a.subscription?.effectivePlan.name ?? t('common.none')}</TableCell>
                  <TableCell>
                    <SubscriptionBadge status={a.subscription?.status ?? null} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {a.subscription?.periodEnd
                      ? formatDateTime(a.subscription.periodEnd)
                      : t('common.none')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(a.businessCount)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatDateTime(a.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {accounts.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={accounts.isFetchingNextPage}
            onClick={() => void accounts.fetchNextPage()}
          >
            {t('common.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
