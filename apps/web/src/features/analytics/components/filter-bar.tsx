import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { isoDate } from '@/lib/format';

import { useAssignees } from '../api/analytics';
import { CUSTOMER_ORIGINS, daysAgo, type Filters, rangeProblem } from '../lib/filters';
import { MultiSelect } from './multi-select';

/** Compact dates first; secondary filters retain their explicit applicability. */
export function FilterBar({
  value,
  onChange,
  canPickSales,
}: {
  value: Filters;
  onChange: (next: Filters) => void;
  canPickSales: boolean;
}) {
  const { t } = useTranslation();
  const assignees = useAssignees();
  const problem = rangeProblem(value);
  const today = new Date();
  const active = value.origins.length !== CUSTOMER_ORIGINS.length || value.sales.length > 0;
  const [expanded, setExpanded] = useState(active);
  const presets = [
    { key: 'preset7', from: daysAgo(6) },
    { key: 'preset30', from: daysAgo(29) },
  ] as const;
  const sales = (assignees.data ?? []).filter((a) => ['sales', 'owner', 'admin'].includes(a.role));
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" aria-label={t('analytics.overview.dateRange')}>
          {presets.map((p) => (
            <Button
              key={p.key}
              type="button"
              variant={
                value.from === p.from && value.to === isoDate(today) ? 'secondary' : 'outline'
              }
              onClick={() => onChange({ ...value, from: p.from, to: isoDate(today) })}
            >
              {t(`analytics.filters.${p.key}`)}
            </Button>
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline">
                {t('analytics.overview.customDates')}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="stat-from">{t('analytics.filters.from')}</Label>
                  <Input
                    id="stat-from"
                    type="date"
                    value={value.from}
                    max={value.to}
                    onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
                    aria-invalid={Boolean(problem)}
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="stat-to">{t('analytics.filters.to')}</Label>
                  <Input
                    id="stat-to"
                    type="date"
                    value={value.to}
                    min={value.from}
                    onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
                    aria-invalid={Boolean(problem)}
                  />
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  onChange({
                    ...value,
                    from: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
                    to: isoDate(today),
                  })
                }
              >
                {t('analytics.filters.thisMonth')}
              </Button>
            </PopoverContent>
          </Popover>
        </div>
        <CollapsibleTrigger asChild>
          <Button type="button" variant={active ? 'secondary' : 'outline'}>
            {t('analytics.overview.moreFilters')}
            {active ? ' •' : ''}
          </Button>
        </CollapsibleTrigger>
      </div>
      <p className="text-xs text-muted-foreground">
        {value.from} — {value.to}
      </p>
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`analytics.filters.${problem}`)}
        </p>
      ) : null}
      {active ? (
        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
          {t('analytics.overview.activeFilters', {
            sources: value.origins.map((o) => t(`analytics.origins.${o}`)).join(', '),
            sales: value.sales.length
              ? value.sales
                  .map(
                    (id) =>
                      sales.find((s) => s.userId === id)?.name ??
                      t('analytics.breakdowns.unknownMember'),
                  )
                  .join(', ')
              : t('analytics.filters.allSales'),
          })}
        </p>
      ) : null}
      <CollapsibleContent className="grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{t('analytics.filters.origin')}</Label>
          <div className="flex flex-wrap gap-2">
            {CUSTOMER_ORIGINS.map((origin) => {
              const on = value.origins.includes(origin);
              return (
                <Button
                  key={origin}
                  type="button"
                  variant={on ? 'secondary' : 'outline'}
                  aria-pressed={on}
                  onClick={() => {
                    const origins = on
                      ? value.origins.filter((o) => o !== origin)
                      : [...value.origins, origin];
                    if (origins.length) onChange({ ...value, origins });
                  }}
                >
                  {t(`analytics.origins.${origin}`)}
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{t('analytics.overview.sourceNote')}</p>
        </div>
        {canPickSales ? (
          <div className="space-y-2">
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
        {active ? (
          <Button
            type="button"
            className="justify-self-start"
            variant="ghost"
            onClick={() => onChange({ ...value, origins: [...CUSTOMER_ORIGINS], sales: [] })}
          >
            {t('analytics.overview.clearFilters')}
          </Button>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
