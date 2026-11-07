import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import type { CalendarPropertyData } from '../../lib/calendar-model';
import {
  addMonths,
  PROPERTY_CALENDAR_VIEWS,
  type PropertyCalendarView,
} from '../../lib/property-calendar-model';
import { InternalNoteCard } from '../calendar-quick-view';

const monthYear = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;

/** "Tháng 11/2026" for a month, "11/2026 – 01/2027" for several. */
export function periodLabel(t: TFunction, view: PropertyCalendarView, month: string): string {
  if (view === 'month' || view === 'list')
    return t('pcal.monthTitle', { month: month.slice(5, 7), year: month.slice(0, 4) });
  const months = view === 'quarter' ? 3 : 12;
  return t('pcal.rangeQuarter', {
    from: monthYear(month),
    to: monthYear(addMonths(month, months - 1)),
  });
}

/**
 * Top of "Lịch căn": back to Lịch, the property's code, name, capacity and internal note,
 * prev / Hôm nay / next and the view switch Tháng | 3 tháng | Năm | Danh sách.
 */
export function PropertyCalendarHeader({
  property,
  view,
  month,
  onStep,
  onView,
}: {
  /** Undefined while the calendar loads. */
  property: CalendarPropertyData | undefined;
  view: PropertyCalendarView;
  /** First night of the anchor month. */
  month: string;
  /** -1 / +1 = previous / next period, 0 = back to today's month. */
  onStep: (direction: -1 | 0 | 1) => void;
  onView: (view: PropertyCalendarView) => void;
}) {
  const { t } = useTranslation('lodging');
  const title = property && (
    <div className="min-w-0">
      <h1 className="flex min-w-0 items-baseline gap-2 text-xl font-semibold">
        <span className="shrink-0">{property.code}</span>
        <span className="min-w-0 truncate text-base font-normal text-muted-foreground">
          {property.name}
        </span>
      </h1>
      <p className="text-xs tabular-nums text-muted-foreground">
        {t('cal.capacity', {
          adults: property.standardAdults,
          children: property.standardChildren,
        })}
        {property.sellMode === 'rooms' && ` · ${t('cal.rooms', { count: property.rows.length })}`}
      </p>
    </div>
  );
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <Link
          to="/app/calendar"
          aria-label={t('pcal.backLabel')}
          className="inline-flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t('pcal.back')}
        </Link>
        {property?.internalNote ? (
          <InternalNoteCard code={property.code} note={property.internalNote}>
            {title}
          </InternalNoteCard>
        ) : (
          title
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {view !== 'list' && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t('pcal.prev')}
              onClick={() => onStep(-1)}
            >
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="sm" onClick={() => onStep(0)}>
              {t('cal.today')}
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t('pcal.next')}
              onClick={() => onStep(1)}
            >
              <ChevronRight />
            </Button>
            <span
              className="ml-1 text-sm font-medium tabular-nums"
              aria-live="polite"
              data-testid="pcal-period"
            >
              {periodLabel(t, view, month)}
            </span>
          </div>
        )}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          aria-label={t('pcal.views')}
          className="sm:ml-auto"
          value={view}
          onValueChange={(v) => {
            const next = PROPERTY_CALENDAR_VIEWS.find((x) => x === v);
            if (next) onView(next);
          }}
        >
          {PROPERTY_CALENDAR_VIEWS.map((v) => (
            <ToggleGroupItem key={v} value={v}>
              {t(`pcal.view.${v}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}

/** "Cả căn · P101 · P102": which rows of a rooms property the views show. */
export function UnitChips({
  property,
  unitId,
  onUnit,
}: {
  property: CalendarPropertyData;
  unitId: string | undefined;
  onUnit: (unitId: string | undefined) => void;
}) {
  const { t } = useTranslation('lodging');
  const WHOLE = '__whole__';
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      aria-label={t('pcal.units')}
      className="flex-wrap justify-start"
      value={unitId ?? WHOLE}
      onValueChange={(v) => v && onUnit(v === WHOLE ? undefined : v)}
    >
      <ToggleGroupItem value={WHOLE}>{t('pcal.wholePlace')}</ToggleGroupItem>
      {property.rows.map((r) => (
        <ToggleGroupItem key={r.unitId} value={r.unitId}>
          {r.name}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
