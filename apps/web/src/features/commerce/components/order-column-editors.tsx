import { useId, useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { useTranslation } from 'react-i18next';

import { presetRange } from '@/components/date-range-picker';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { formatNumber, isoDate } from '@/lib/format';
import { cn } from '@/lib/utils';

import { DATE_PRESETS, type ListOption } from './order-column-filters';

/** Lower-case, accents removed: "Giao hàng" matches "giao hang". */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

/** "Contains" text box; Enter applies. */
export function TextEditor({
  label,
  value,
  onChange,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {t('orders.columnMenu.contains', { name: label })}
      </label>
      <Input
        id={id}
        autoFocus
        value={value}
        maxLength={100}
        placeholder={t('orders.columnMenu.containsPlaceholder')}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit();
          }
        }}
        className="h-8"
      />
    </div>
  );
}

/** Ticked values with Excel-style counts, a search box and select all / none. */
export function ChecklistEditor({
  label,
  options,
  counts,
  chosen,
  onChange,
  searchable,
}: {
  label: string;
  options: readonly ListOption[];
  /** Missing: the API sent no counts; no numbers are shown. */
  counts: Record<string, number> | undefined;
  chosen: readonly string[];
  onChange: (next: string[]) => void;
  searchable: boolean;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const shown = query ? options.filter((o) => fold(o.label).includes(fold(query))) : options;
  const picked = new Set(chosen);
  const shownValues = shown.map((o) => o.value);
  return (
    <div className="flex flex-col gap-1.5">
      {searchable ? (
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('orders.columnMenu.searchList')}
          aria-label={t('orders.columnMenu.searchListIn', { name: label })}
          className="h-8"
        />
      ) : null}
      <div className="flex items-center gap-1 text-xs">
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-6 px-1"
          disabled={!shown.length}
          onClick={() => onChange([...new Set([...chosen, ...shownValues])])}
        >
          {t('orders.columnMenu.selectAll')}
        </Button>
        <span aria-hidden className="text-muted-foreground">
          ·
        </span>
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-6 px-1"
          disabled={!chosen.length}
          onClick={() => onChange(chosen.filter((v) => !shownValues.includes(v)))}
        >
          {t('orders.columnMenu.selectNone')}
        </Button>
      </div>
      <ul
        aria-label={label}
        className="-mx-1 flex max-h-60 flex-col overflow-y-auto overscroll-contain"
      >
        {shown.map((o) => {
          const count = counts ? (counts[o.value] ?? 0) : undefined;
          return (
            <li key={o.value}>
              <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted has-focus-visible:bg-muted">
                <Checkbox
                  checked={picked.has(o.value)}
                  onCheckedChange={() =>
                    onChange(
                      picked.has(o.value)
                        ? chosen.filter((v) => v !== o.value)
                        : [...chosen, o.value],
                    )
                  }
                />
                <span className="min-w-0 flex-1 truncate" title={o.label}>
                  {o.label}
                </span>
                {count !== undefined ? (
                  <span
                    className={cn(
                      'text-xs tabular-nums',
                      count ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {formatNumber(count)}
                  </span>
                ) : null}
              </label>
            </li>
          );
        })}
        {!shown.length ? (
          <li className="px-1.5 py-2 text-muted-foreground">{t('orders.columnMenu.noOptions')}</li>
        ) : null}
      </ul>
    </div>
  );
}

/** An exclusion switch under the status checklist. */
export function ExcludeToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex min-h-8 cursor-pointer items-center gap-2 border-t pt-2">
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} />
      {t('orders.filters.exclude')}
    </label>
  );
}

const digits = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 13);
  return d ? Number(d) : undefined;
};

/** Inclusive from–to amount in VND; Enter applies. */
export function MoneyEditor({
  min,
  max,
  onChange,
  onSubmit,
}: {
  min: number | undefined;
  max: number | undefined;
  onChange: (next: { min: number | undefined; max: number | undefined }) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const ids = [useId(), useId()];
  const field = (key: 'min' | 'max', i: number) => (
    <div className="flex flex-1 flex-col gap-1.5">
      <label htmlFor={ids[i]} className="text-xs text-muted-foreground">
        {t(key === 'min' ? 'orders.columnMenu.moneyFrom' : 'orders.columnMenu.moneyTo')}
      </label>
      <div className="relative">
        <Input
          id={ids[i]}
          autoFocus={key === 'min'}
          inputMode="numeric"
          value={
            (key === 'min' ? min : max) === undefined
              ? ''
              : formatNumber((key === 'min' ? min : max) ?? 0)
          }
          onChange={(e) => onChange({ min, max, [key]: digits(e.target.value) })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit();
            }
          }}
          className="h-8 pr-6 text-right tabular-nums"
        />
        <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">
          ₫
        </span>
      </div>
    </div>
  );
  return (
    <div className="flex items-end gap-2">
      {field('min', 0)}
      <span aria-hidden className="pb-1.5 text-muted-foreground">
        –
      </span>
      {field('max', 1)}
    </div>
  );
}

const toDate = (iso: string) => new Date(`${iso}T00:00:00`);

/** Quick presets (applied at once) plus a date range. */
export function DateEditor({
  from,
  to,
  onChange,
  onPreset,
}: {
  from: string | undefined;
  to: string | undefined;
  onChange: (next: { from: string | undefined; to: string | undefined }) => void;
  onPreset: (range: { from: string; to: string }) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DateRange | undefined>(
    from && to ? { from: toDate(from), to: toDate(to) } : undefined,
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-1">
        {DATE_PRESETS.map((p) => {
          const r = presetRange(p);
          const active = r.from === from && r.to === to;
          return (
            <Button
              key={p}
              type="button"
              variant={active ? 'secondary' : 'outline'}
              size="sm"
              aria-pressed={active}
              className={cn('justify-start font-normal', active && 'text-primary')}
              onClick={() => onPreset(r)}
            >
              {t(`orders.columnMenu.presets.${p}`)}
            </Button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t('orders.columnMenu.dateCustom')}</p>
      <Calendar
        mode="range"
        numberOfMonths={1}
        className="mx-auto p-0"
        selected={draft}
        {...(draft?.from ? { defaultMonth: draft.from } : {})}
        onSelect={(r) => {
          setDraft(r);
          onChange({
            from: r?.from ? isoDate(r.from) : undefined,
            to: r?.from ? isoDate(r.to ?? r.from) : undefined,
          });
        }}
      />
    </div>
  );
}
