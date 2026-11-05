import type { PropertyDto, QuoteDto } from '@agent-sales/contracts';
import { CircleAlert, Loader2 } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';

import { isStayRange, nightsBetween } from '../lib/format';
import { type PackageChoice, packageOptions, targetKey } from '../lib/package-choice';

/** A titled block of the booking sheet. */
export function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** Check-in / check-out inputs with the night count and an inline range error. */
export function StayDates({
  checkIn,
  checkOut,
  onChange,
  disableCheckIn = false,
  showError,
}: {
  checkIn: string;
  checkOut: string;
  onChange: (next: { checkIn: string; checkOut: string }) => void;
  disableCheckIn?: boolean;
  showError: boolean;
}) {
  const { t } = useTranslation('lodging');
  const id = useId();
  const valid = isStayRange(checkIn, checkOut);
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-in`} className="text-xs">
            {t('sheet.checkIn')}
          </Label>
          <Input
            id={`${id}-in`}
            type="date"
            className="h-8 w-40 tabular-nums"
            value={checkIn}
            disabled={disableCheckIn}
            aria-invalid={(showError && !valid) || undefined}
            onChange={(e) => onChange({ checkIn: e.target.value, checkOut })}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${id}-out`} className="text-xs">
            {t('sheet.checkOut')}
          </Label>
          <Input
            id={`${id}-out`}
            type="date"
            className="h-8 w-40 tabular-nums"
            min={checkIn || undefined}
            value={checkOut}
            aria-invalid={(showError && !valid) || undefined}
            onChange={(e) => onChange({ checkIn, checkOut: e.target.value })}
          />
        </div>
        {valid && (
          <span className="pb-1.5 text-sm tabular-nums text-muted-foreground">
            {t('sheet.nights', { count: nightsBetween(checkIn, checkOut) })}
          </span>
        )}
      </div>
      {showError && !valid && <p className="text-xs text-destructive">{t('sheet.invalidRange')}</p>}
    </div>
  );
}

/** "Nguyên căn" plus one chip per active room of a `rooms` property. */
export function UnitPicker({
  property,
  whole,
  unitIds,
  onChange,
  showError,
}: {
  property: PropertyDto | undefined;
  whole: boolean;
  unitIds: string[];
  onChange: (next: { whole: boolean; unitIds: string[] }) => void;
  showError: boolean;
}) {
  const { t } = useTranslation('lodging');
  if (!property) return null;
  const rooms =
    property.sellMode === 'rooms'
      ? property.units.filter((u) => u.kind === 'room' && u.active)
      : [];
  const chip =
    'h-7 rounded-full border border-border px-3 text-xs data-[state=on]:border-primary data-[state=on]:bg-primary-soft data-[state=on]:text-primary-strong';
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium">{t('sheet.units')}</span>
      <div className="flex flex-wrap gap-1.5">
        <Toggle
          size="sm"
          className={chip}
          pressed={whole}
          disabled={rooms.length === 0}
          onPressedChange={() => onChange({ whole: true, unitIds: [] })}
        >
          {t('sheet.whole')}
        </Toggle>
        {rooms.map((u) => {
          const on = !whole && unitIds.includes(u.id);
          return (
            <Toggle
              key={u.id}
              size="sm"
              className={chip}
              pressed={on}
              onPressedChange={() => {
                const base = whole ? [] : unitIds;
                const next = on ? base.filter((x) => x !== u.id) : [...base, u.id];
                onChange({ whole: false, unitIds: next });
              }}
            >
              {u.name}
            </Toggle>
          );
        })}
      </div>
      {showError && !whole && unitIds.length === 0 && (
        <p className="text-xs text-destructive">{t('sheet.chooseUnit')}</p>
      )}
    </div>
  );
}

/**
 * One package select per target of the selection that has packages ("Gói", or "Gói · B1" for a
 * room). It shows the chosen package, else the one the quote picked; a change re-quotes.
 */
export function PackagePicker({
  property,
  targets,
  choice,
  quote,
  onChange,
}: {
  property: PropertyDto | undefined;
  targets: readonly (string | null)[];
  choice: PackageChoice;
  quote: QuoteDto | undefined;
  onChange: (next: PackageChoice) => void;
}) {
  const { t } = useTranslation('lodging');
  const id = useId();
  if (!property || targets.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {targets.map((target) => {
        const key = targetKey(target);
        const unit = target ? property.units.find((u) => u.id === target) : undefined;
        const value =
          choice[key] ?? quote?.packages.find((k) => k.target === target)?.packageId ?? '';
        const selectId = `${id}-${key || 'whole'}`;
        return (
          <div key={key} className="grid gap-1">
            <Label htmlFor={selectId} className="text-xs">
              {unit ? t('sheet.packageOf', { name: unit.name }) : t('sheet.package')}
            </Label>
            <Select value={value} onValueChange={(v) => onChange({ ...choice, [key]: v })}>
              <SelectTrigger id={selectId} size="sm" className="w-40">
                <SelectValue placeholder={t('packages.selectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {packageOptions(property, target).map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}

/** Bookings already on the chosen nights (from the live quote). */
export function TakenAlert({ quote }: { quote: QuoteDto | undefined }) {
  const { t } = useTranslation('lodging');
  if (!quote?.takenBy.length) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>{t('sheet.takenBy', { codes: quote.takenBy.join(', ') })}</AlertDescription>
    </Alert>
  );
}

/** Submit button with a spinner while saving. */
export function SavingLabel({ saving, children }: { saving: boolean; children: ReactNode }) {
  return (
    <>
      {saving && <Loader2 aria-hidden className={cn('animate-spin')} />}
      {children}
    </>
  );
}
