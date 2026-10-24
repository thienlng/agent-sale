import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatDate, isoDate } from '@/lib/format';

export interface IsoRange {
  from: string;
  to: string;
}

const PRESETS = ['today', 'yesterday', 'last7', 'monthToDate', 'lastMonth', 'last30'] as const;
export type RangePreset = (typeof PRESETS)[number];

/** The dates of a preset, inclusive, as yyyy-mm-dd in the browser's calendar. */
export function presetRange(preset: RangePreset, now = new Date()): IsoRange {
  const d = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  switch (preset) {
    case 'today':
      return { from: isoDate(d(0)), to: isoDate(d(0)) };
    case 'yesterday':
      return { from: isoDate(d(-1)), to: isoDate(d(-1)) };
    case 'last7':
      return { from: isoDate(d(-6)), to: isoDate(d(0)) };
    case 'last30':
      return { from: isoDate(d(-29)), to: isoDate(d(0)) };
    case 'monthToDate':
      return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDate(d(0)) };
    case 'lastMonth':
      return {
        from: isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: isoDate(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
  }
}

const toDate = (iso: string) => new Date(`${iso}T00:00:00`);

/** Range button + popover with presets and a two-month calendar (one month on phones). */
export function DateRangePicker({
  value,
  onChange,
  allowClear,
}: {
  value: IsoRange | null;
  onChange: (range: IsoRange | null) => void;
  allowClear?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(
    value ? { from: toDate(value.from), to: toDate(value.to) } : undefined,
  );
  const label = value
    ? value.from === value.to
      ? formatDate(value.from)
      : `${formatDate(value.from)} – ${formatDate(value.to)}`
    : t('overview.range');

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(value ? { from: toDate(value.from), to: toDate(value.to) } : undefined);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-9 justify-start gap-2 font-normal">
          <CalendarDays className="text-muted-foreground" />
          <span className="tabular-nums">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-auto flex-col gap-3 p-3 sm:flex-row">
        <div className="flex flex-wrap gap-1 sm:w-40 sm:flex-col">
          {PRESETS.map((p) => (
            <Button
              key={p}
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => {
                onChange(presetRange(p));
                setOpen(false);
              }}
            >
              {t(`overview.presets.${p}`)}
            </Button>
          ))}
          {allowClear && value ? (
            <Button
              variant="ghost"
              size="sm"
              className="justify-start text-muted-foreground"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              {t('orders.all')}
            </Button>
          ) : null}
        </div>
        <Calendar
          mode="range"
          numberOfMonths={typeof window !== 'undefined' && window.innerWidth < 640 ? 1 : 2}
          selected={draft}
          {...(draft?.from ? { defaultMonth: draft.from } : {})}
          onSelect={(r) => {
            setDraft(r);
            if (r?.from && r.to) {
              onChange({ from: isoDate(r.from), to: isoDate(r.to) });
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
