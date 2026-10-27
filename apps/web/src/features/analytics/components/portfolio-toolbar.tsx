import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { isoDate } from '@/lib/format';

import { daysAgo, type Filters, type FiltersSearch, toSearch } from '../lib/filters';

export function DateRangeToolbar({
  value,
  onChange,
}: {
  value: Filters;
  onChange: (next: FiltersSearch) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {[7, 30].map((days) => (
        <Button
          key={days}
          variant={
            value.from === daysAgo(days - 1) && value.to === isoDate(new Date())
              ? 'secondary'
              : 'outline'
          }
          onClick={() =>
            onChange(toSearch({ ...value, from: daysAgo(days - 1), to: isoDate(new Date()) }))
          }
        >
          {t(`analytics.filters.preset${days}`)}
        </Button>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">{t('analytics.overview.customDates')}</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
          <Label htmlFor="portfolio-from">{t('analytics.filters.from')}</Label>
          <Input
            id="portfolio-from"
            type="date"
            value={value.from}
            max={value.to}
            onChange={(e) =>
              e.target.value && onChange(toSearch({ ...value, from: e.target.value }))
            }
          />
          <Label htmlFor="portfolio-to">{t('analytics.filters.to')}</Label>
          <Input
            id="portfolio-to"
            type="date"
            value={value.to}
            min={value.from}
            onChange={(e) => e.target.value && onChange(toSearch({ ...value, to: e.target.value }))}
          />
        </PopoverContent>
      </Popover>
      <span className="text-xs text-muted-foreground">
        {value.from} — {value.to}
      </span>
    </div>
  );
}
