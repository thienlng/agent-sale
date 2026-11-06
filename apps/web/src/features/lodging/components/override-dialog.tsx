import type { PropertyDto, RateDto } from '@agent-sales/contracts';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { MoneyInput } from '@/components/money-input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useCreateOverride, useUpdateOverride } from '../api/properties';
import { useSaveError } from '../hooks/use-save-error';
import { SavingLabel } from './booking-fields';
import { Field } from './property-tab-parts';

const WHOLE = 'whole';

interface OverrideDraft {
  label: string;
  dateFrom: string;
  dateTo: string;
  target: string;
  /** '' = none (a target without packages). */
  packageId: string;
  sell: number;
  cost: number;
  minNights: string;
}

/** Packages of a target, most bedrooms (the full package) first. */
const packagesOfTarget = (p: PropertyDto, unitId: string | null) =>
  p.packages
    .filter((k) => k.unitId === unitId)
    .sort((a, b) => b.bedrooms - a.bedrooms || b.sortOrder - a.sortOrder);

const draftOf = (
  p: PropertyDto,
  rate: RateDto | null,
  lockedTarget: string | null | undefined,
): OverrideDraft => {
  const unitId = rate ? rate.unitId : (lockedTarget ?? null);
  return {
    label: rate?.label ?? '',
    dateFrom: rate?.dateFrom ?? '',
    dateTo: rate?.dateTo ?? '',
    target: unitId ?? WHOLE,
    packageId: rate ? (rate.packageId ?? '') : (packagesOfTarget(p, unitId)[0]?.id ?? ''),
    sell: rate?.sell ?? 0,
    cost: rate?.cost ?? 0,
    minNights: rate?.minNights ? String(rate.minNights) : '',
  };
};

/** True when [a1, a2] and [b1, b2] (inclusive 'YYYY-MM-DD') share a night. */
const overlaps = (a1: string, a2: string, b1: string, b2: string) => a1 <= b2 && b1 <= a2;

/**
 * Add or edit one "Ngày đặc biệt": name, inclusive nights, target, package (required
 * when the target has packages), sell/cost, min nights. `lockedTarget` (a unit page)
 * fixes the target and hides its select.
 */
export function OverrideDialog({
  property: p,
  rate,
  lockedTarget,
  onClose,
}: {
  property: PropertyDto;
  /** null = add a new one. */
  rate: RateDto | null;
  lockedTarget?: string | null | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation('lodging');
  const id = useId();
  const [d, setD] = useState(() => draftOf(p, rate, lockedTarget));
  const [submitted, setSubmitted] = useState(false);
  const create = useCreateOverride();
  const update = useUpdateOverride();
  const saveError = useSaveError();
  const pending = create.isPending || update.isPending;
  const rooms = p.sellMode === 'rooms' ? p.units.filter((u) => u.kind === 'room') : [];
  const unitId = d.target === WHOLE ? null : d.target;
  const targetPackages = packagesOfTarget(p, unitId);
  const packageId = targetPackages.length ? d.packageId || null : null;
  const minNights = d.minNights ? Number(d.minNights) : null;
  const minInvalid =
    minNights !== null && (!Number.isInteger(minNights) || minNights < 1 || minNights > 60);
  const errors = {
    label: !d.label.trim(),
    from: !d.dateFrom,
    to: !d.dateTo || (Boolean(d.dateFrom) && d.dateFrom > d.dateTo),
    sell: !d.sell,
    package: targetPackages.length > 0 && !packageId,
    min: minInvalid,
  };
  const invalid = Object.values(errors).some(Boolean);
  const overlap =
    !invalid &&
    p.rates.some(
      (r) =>
        r.kind === 'override' &&
        r.id !== rate?.id &&
        r.unitId === unitId &&
        r.packageId === packageId &&
        r.dateFrom &&
        r.dateTo &&
        overlaps(d.dateFrom, d.dateTo, r.dateFrom, r.dateTo),
    );
  const err = (bad: boolean, key: string) => (submitted && bad ? t(key) : undefined);
  const required = 'places.required';
  const set = (patch: Partial<OverrideDraft>) => setD((v) => ({ ...v, ...patch }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (invalid || overlap || pending) return;
    const body = {
      label: d.label.trim(),
      dateFrom: d.dateFrom,
      dateTo: d.dateTo,
      unitId,
      packageId,
      sell: d.sell,
      cost: d.cost || d.sell,
      minNights,
      version: p.version,
    };
    const done = {
      onSuccess: () => {
        toast.success(t('overrides.saved'), { duration: 3500 });
        onClose();
      },
      onError: (error: unknown) => saveError(error),
    };
    if (rate) update.mutate({ id: p.id, rateId: rate.id, body }, done);
    else create.mutate({ id: p.id, body }, done);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(rate ? 'overrides.dialogEdit' : 'overrides.dialogAdd')}</DialogTitle>
          <DialogDescription>{t('overrides.hint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-3">
          <Field
            id={`${id}-label`}
            label={t('overrides.label')}
            error={err(errors.label, required)}
          >
            <Input
              id={`${id}-label`}
              value={d.label}
              maxLength={100}
              placeholder={t('overrides.labelPlaceholder')}
              aria-invalid={(submitted && errors.label) || undefined}
              onChange={(e) => set({ label: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${id}-from`} label={t('overrides.from')} error={err(errors.from, required)}>
              <Input
                id={`${id}-from`}
                type="date"
                value={d.dateFrom}
                aria-invalid={(submitted && (errors.from || overlap)) || undefined}
                onChange={(e) => set({ dateFrom: e.target.value })}
              />
            </Field>
            <Field
              id={`${id}-to`}
              label={t('overrides.to')}
              error={err(errors.to, 'overrides.rangeInvalid') ?? err(overlap, 'overrides.overlap')}
            >
              <Input
                id={`${id}-to`}
                type="date"
                value={d.dateTo}
                min={d.dateFrom || undefined}
                aria-invalid={(submitted && (errors.to || overlap)) || undefined}
                onChange={(e) => set({ dateTo: e.target.value })}
              />
            </Field>
          </div>
          {rooms.length > 0 && lockedTarget === undefined && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-target`}>{t('overrides.target')}</Label>
              <Select
                value={d.target}
                onValueChange={(target) =>
                  set({
                    target,
                    packageId: packagesOfTarget(p, target === WHOLE ? null : target)[0]?.id ?? '',
                  })
                }
              >
                <SelectTrigger id={`${id}-target`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WHOLE}>{t('rates.whole')}</SelectItem>
                  {rooms.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {targetPackages.length > 0 && (
            <Field
              id={`${id}-package`}
              label={t('packages.select')}
              error={err(errors.package, required)}
            >
              <Select value={d.packageId} onValueChange={(v) => set({ packageId: v })}>
                <SelectTrigger
                  id={`${id}-package`}
                  className="w-full"
                  aria-invalid={(submitted && errors.package) || undefined}
                >
                  <SelectValue placeholder={t('packages.selectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {targetPackages.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${id}-sell`} label={t('rates.sell')} error={err(errors.sell, required)}>
              <MoneyInput
                id={`${id}-sell`}
                value={d.sell}
                aria-invalid={(submitted && errors.sell) || undefined}
                onValueChange={(sell) => set({ sell })}
              />
            </Field>
            <Field id={`${id}-cost`} label={t('rates.cost')}>
              <MoneyInput
                id={`${id}-cost`}
                value={d.cost}
                onValueChange={(cost) => set({ cost })}
              />
            </Field>
          </div>
          <Field
            id={`${id}-min`}
            label={t('overrides.minNights')}
            hint={t('overrides.minNightsHint')}
            error={err(errors.min, 'overrides.minInvalid')}
          >
            <Input
              id={`${id}-min`}
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              className="w-28"
              value={d.minNights}
              aria-invalid={(submitted && errors.min) || undefined}
              onChange={(e) => set({ minNights: e.target.value })}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('overrides.keep')}
            </Button>
            <Button type="submit" disabled={pending}>
              <SavingLabel saving={pending}>{t('overrides.save')}</SavingLabel>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
