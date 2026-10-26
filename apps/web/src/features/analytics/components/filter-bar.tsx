import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isoDate } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useAssignees, usePages } from '../api/analytics';
import { CUSTOMER_ORIGINS, daysAgo, type Filters, rangeProblem } from '../lib/filters';
import { MultiSelect } from './multi-select';

/** Date range, customer source, salesperson and page. What does not apply to a number is said, not hidden. */
export function FilterBar({
  value,
  onChange,
  canPickSales,
}: {
  value: Filters;
  onChange: (next: Filters) => void;
  /** A salesperson only sees their own customers, so choosing another one is pointless. */
  canPickSales: boolean;
}) {
  const { t } = useTranslation();
  const assignees = useAssignees();
  const pages = usePages();
  const problem = rangeProblem(value);
  const today = new Date();
  const presets = [
    { key: 'preset7', from: daysAgo(6), to: isoDate(today) },
    { key: 'preset30', from: daysAgo(29), to: isoDate(today) },
    {
      key: 'thisMonth',
      from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: isoDate(today),
    },
  ] as const;
  const sales = (assignees.data ?? []).filter(
    (a) => a.role === 'sales' || a.role === 'owner' || a.role === 'admin',
  );
  const connected = (pages.data ?? []).filter((p) => p.status !== 'disconnected');

  return (
    <section
      className="flex flex-col gap-4 rounded-lg border p-4"
      aria-label={t('analytics.title')}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stat-from" className="text-sm text-muted-foreground">
            {t('analytics.filters.from')}
          </Label>
          <Input
            id="stat-from"
            type="date"
            className="h-9 w-40"
            value={value.from}
            max={value.to}
            onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
            aria-invalid={Boolean(problem)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stat-to" className="text-sm text-muted-foreground">
            {t('analytics.filters.to')}
          </Label>
          <Input
            id="stat-to"
            type="date"
            className="h-9 w-40"
            value={value.to}
            min={value.from}
            onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
            aria-invalid={Boolean(problem)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <Button
              key={p.key}
              type="button"
              size="sm"
              variant={value.from === p.from && value.to === p.to ? 'secondary' : 'outline'}
              onClick={() => onChange({ ...value, from: p.from, to: p.to })}
            >
              {t(`analytics.filters.${p.key}`)}
            </Button>
          ))}
        </div>
      </div>
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`analytics.filters.${problem}`)}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-sm text-muted-foreground">{t('analytics.filters.origin')}</Label>
          <div className="flex flex-wrap gap-2">
            {CUSTOMER_ORIGINS.map((o) => {
              const on = value.origins.includes(o);
              return (
                <Button
                  key={o}
                  type="button"
                  size="sm"
                  variant={on ? 'secondary' : 'outline'}
                  aria-pressed={on}
                  className={cn(!on && 'text-muted-foreground')}
                  onClick={() => {
                    const next = on ? value.origins.filter((x) => x !== o) : [...value.origins, o];
                    // At least one source stays chosen: none would silently count nothing.
                    if (next.length) onChange({ ...value, origins: next });
                  }}
                >
                  {t(`analytics.origins.${o}`)}
                </Button>
              );
            })}
          </div>
        </div>
        {canPickSales ? (
          <div className="flex flex-col gap-1">
            <MultiSelect
              label={t('analytics.filters.sales')}
              allLabel={t('analytics.filters.allSales')}
              emptyLabel={t('analytics.filters.noSales')}
              options={sales.map((a) => ({ value: a.userId, label: a.name }))}
              value={value.sales}
              onChange={(sales) => onChange({ ...value, sales })}
            />
            <p className="text-xs text-muted-foreground">{t('analytics.filters.salesNote')}</p>
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <MultiSelect
            label={t('analytics.filters.page')}
            allLabel={t('analytics.filters.allPages')}
            emptyLabel={t('analytics.filters.noPages')}
            options={connected.map((p) => ({ value: p.id, label: p.name }))}
            value={value.pages}
            onChange={(pages) => onChange({ ...value, pages })}
          />
          <p className="text-xs text-muted-foreground">
            {connected.length === 0 && !pages.isPending ? (
              <>
                {t('analytics.filters.noPages')} ·{' '}
                <Link to="/app/channels" className="text-primary hover:underline">
                  {t('analytics.filters.connectPages')}
                </Link>
              </>
            ) : (
              t('analytics.filters.pageNote')
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
