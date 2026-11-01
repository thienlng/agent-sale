import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { addDays, dayMonth } from '../lib/format';

export type RangeNights = 14 | 31;
const ALL = '__all__';

/** ◀ Hôm nay ▶, 2 tuần / Tháng, area filter and "only free places". */
export function CalendarToolbar({
  from,
  nights,
  shownNights = nights,
  showRange = true,
  onShift,
  onNights,
  areas,
  area,
  onArea,
  onlyFree,
  onOnlyFree,
}: {
  from: string;
  nights: RangeNights;
  /** Nights actually shown (the phone view always shows a month). */
  shownNights?: number;
  /** The 2 tuần / Tháng switch (hidden on phones, which always show a month). */
  showRange?: boolean;
  onShift: (direction: -1 | 0 | 1) => void;
  onNights: (nights: RangeNights) => void;
  areas: string[];
  area: string;
  onArea: (area: string) => void;
  onlyFree: boolean;
  onOnlyFree: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t('lodging.cal.prev')}
          onClick={() => onShift(-1)}
        >
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="sm" onClick={() => onShift(0)}>
          {t('lodging.cal.today')}
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t('lodging.cal.next')}
          onClick={() => onShift(1)}
        >
          <ChevronRight />
        </Button>
        <span className="ml-1 text-sm tabular-nums text-muted-foreground">
          {dayMonth(from)} – {dayMonth(addDays(from, shownNights - 1))}
        </span>
      </div>
      {showRange && (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label={t('lodging.cal.range')}
          value={String(nights)}
          onValueChange={(v) => v && onNights(v === '31' ? 31 : 14)}
        >
          <ToggleGroupItem value="14">{t('lodging.cal.twoWeeks')}</ToggleGroupItem>
          <ToggleGroupItem value="31">{t('lodging.cal.month')}</ToggleGroupItem>
        </ToggleGroup>
      )}
      {areas.length > 1 && (
        <Select value={area || ALL} onValueChange={(v) => onArea(v === ALL ? '' : v)}>
          <SelectTrigger size="sm" aria-label={t('lodging.cal.area')} className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('lodging.cal.allAreas')}</SelectItem>
            {areas.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="flex items-center gap-2">
        <Switch id={`${id}-free`} checked={onlyFree} onCheckedChange={onOnlyFree} />
        <Label htmlFor={`${id}-free`} className="text-sm font-normal">
          {t('lodging.cal.onlyFree')}
        </Label>
      </div>
    </div>
  );
}
