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
  sell: number;
  cost: number;
  minNights: string;
}

const draftOf = (rate: RateDto | null): OverrideDraft => ({
  label: rate?.label ?? '',
  dateFrom: rate?.dateFrom ?? '',
  dateTo: rate?.dateTo ?? '',
  target: rate?.unitId ?? WHOLE,
  sell: rate?.sell ?? 0,
  cost: rate?.cost ?? 0,
  minNights: rate?.minNights ? String(rate.minNights) : '',
});

/** True when [a1, a2] and [b1, b2] (inclusive 'YYYY-MM-DD') share a night. */
const overlaps = (a1: string, a2: string, b1: string, b2: string) => a1 <= b2 && b1 <= a2;

/** Add or edit one "Ngày đặc biệt": name, inclusive nights, target, sell/cost, min nights. */
export function OverrideDialog({
  property: p,
  rate,
  onClose,
}: {
  property: PropertyDto;
  /** null = add a new one. */
  rate: RateDto | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [d, setD] = useState(() => draftOf(rate));
  const [submitted, setSubmitted] = useState(false);
  const create = useCreateOverride();
  const update = useUpdateOverride();
  const saveError = useSaveError();
  const pending = create.isPending || update.isPending;
  const rooms = p.sellMode === 'rooms' ? p.units.filter((u) => u.kind === 'room') : [];
  const unitId = d.target === WHOLE ? null : d.target;
  const minNights = d.minNights ? Number(d.minNights) : null;
  const minInvalid =
    minNights !== null && (!Number.isInteger(minNights) || minNights < 1 || minNights > 60);
  const errors = {
    label: !d.label.trim(),
    from: !d.dateFrom,
    to: !d.dateTo || (Boolean(d.dateFrom) && d.dateFrom > d.dateTo),
    sell: !d.sell,
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
        r.dateFrom &&
        r.dateTo &&
        overlaps(d.dateFrom, d.dateTo, r.dateFrom, r.dateTo),
    );
  const err = (bad: boolean, key: string) => (submitted && bad ? t(key) : undefined);
  const required = 'lodging.places.required';
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
      sell: d.sell,
      cost: d.cost || d.sell,
      minNights,
      version: p.version,
    };
    const done = {
      onSuccess: () => {
        toast.success(t('lodging.overrides.saved'), { duration: 3500 });
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
          <DialogTitle>
            {t(rate ? 'lodging.overrides.dialogEdit' : 'lodging.overrides.dialogAdd')}
          </DialogTitle>
          <DialogDescription>{t('lodging.overrides.hint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-3">
          <Field
            id={`${id}-label`}
            label={t('lodging.overrides.label')}
            error={err(errors.label, required)}
          >
            <Input
              id={`${id}-label`}
              value={d.label}
              maxLength={100}
              placeholder={t('lodging.overrides.labelPlaceholder')}
              aria-invalid={(submitted && errors.label) || undefined}
              onChange={(e) => set({ label: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              id={`${id}-from`}
              label={t('lodging.overrides.from')}
              error={err(errors.from, required)}
            >
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
              label={t('lodging.overrides.to')}
              error={
                err(errors.to, 'lodging.overrides.rangeInvalid') ??
                err(overlap, 'lodging.overrides.overlap')
              }
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
          {rooms.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-target`}>{t('lodging.overrides.target')}</Label>
              <Select value={d.target} onValueChange={(target) => set({ target })}>
                <SelectTrigger id={`${id}-target`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WHOLE}>{t('lodging.rates.whole')}</SelectItem>
                  {rooms.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field
              id={`${id}-sell`}
              label={t('lodging.rates.sell')}
              error={err(errors.sell, required)}
            >
              <MoneyInput
                id={`${id}-sell`}
                value={d.sell}
                aria-invalid={(submitted && errors.sell) || undefined}
                onValueChange={(sell) => set({ sell })}
              />
            </Field>
            <Field id={`${id}-cost`} label={t('lodging.rates.cost')}>
              <MoneyInput
                id={`${id}-cost`}
                value={d.cost}
                onValueChange={(cost) => set({ cost })}
              />
            </Field>
          </div>
          <Field
            id={`${id}-min`}
            label={t('lodging.overrides.minNights')}
            hint={t('lodging.overrides.minNightsHint')}
            error={err(errors.min, 'lodging.overrides.minInvalid')}
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
              {t('lodging.overrides.keep')}
            </Button>
            <Button type="submit" disabled={pending}>
              <SavingLabel saving={pending}>{t('lodging.overrides.save')}</SavingLabel>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
