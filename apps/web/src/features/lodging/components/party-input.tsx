import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

import type { PartyValue } from '../lib/party';

const clampInt = (raw: string, min: number, max: number) => {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
};

/**
 * Adults, number of children and one age box per child (ages drive child surcharges). The
 * `compact` variant (one-row find bar) leaves the missing-age message to its parent, so the
 * row does not wrap and push the inputs out of line.
 */
export function PartyInput({
  value,
  onChange,
  compact = false,
}: {
  value: PartyValue;
  onChange: (next: PartyValue) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation('lodging');
  const id = useId();
  const setChildren = (count: number) =>
    onChange({
      ...value,
      childAges: Array.from({ length: count }, (_, i) => value.childAges[i] ?? null),
    });
  const missing = value.childAges.some((a) => a === null);
  return (
    <div className={cn('flex flex-wrap items-end gap-2', compact && 'gap-1.5')}>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-adults`} className="text-xs">
          {t('party.adults')}
        </Label>
        <Input
          id={`${id}-adults`}
          type="number"
          inputMode="numeric"
          min={0}
          max={1000}
          className="w-16 tabular-nums"
          value={value.adults}
          onChange={(e) => onChange({ ...value, adults: clampInt(e.target.value, 0, 1000) })}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-children`} className="text-xs">
          {t('party.children')}
        </Label>
        <Input
          id={`${id}-children`}
          type="number"
          inputMode="numeric"
          min={0}
          max={20}
          className="w-16 tabular-nums"
          value={value.childAges.length}
          onChange={(e) => setChildren(clampInt(e.target.value, 0, 20))}
        />
      </div>
      {value.childAges.map((age, i) => (
        <div key={i} className="grid gap-1">
          <Label htmlFor={`${id}-age-${i}`} className="text-xs text-muted-foreground">
            {t('party.childAge', { n: i + 1 })}
          </Label>
          <Input
            id={`${id}-age-${i}`}
            type="number"
            inputMode="numeric"
            min={0}
            max={17}
            className="w-16 tabular-nums"
            aria-invalid={age === null || undefined}
            value={age ?? ''}
            onChange={(e) => {
              const childAges = [...value.childAges];
              childAges[i] = e.target.value === '' ? null : clampInt(e.target.value, 0, 17);
              onChange({ ...value, childAges });
            }}
          />
        </div>
      ))}
      {missing && !compact && (
        <p className="w-full text-xs text-destructive">{t('party.agesRequired')}</p>
      )}
    </div>
  );
}
