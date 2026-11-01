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
  const invalid =
    !d.label.trim() ||
    !d.dateFrom ||
    !d.dateTo ||
    d.dateFrom > d.dateTo ||
    !d.sell ||
    (minNights !== null && (!Number.isInteger(minNights) || minNights < 1 || minNights > 60));
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
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-label`}>{t('lodging.overrides.label')}</Label>
            <Input
              id={`${id}-label`}
              value={d.label}
              maxLength={100}
              placeholder={t('lodging.overrides.labelPlaceholder')}
              onChange={(e) => set({ label: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-from`}>{t('lodging.overrides.from')}</Label>
              <Input
                id={`${id}-from`}
                type="date"
                value={d.dateFrom}
                onChange={(e) => set({ dateFrom: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-to`}>{t('lodging.overrides.to')}</Label>
              <Input
                id={`${id}-to`}
                type="date"
                value={d.dateTo}
                min={d.dateFrom || undefined}
                onChange={(e) => set({ dateTo: e.target.value })}
              />
            </div>
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
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-sell`}>{t('lodging.rates.sell')}</Label>
              <MoneyInput
                id={`${id}-sell`}
                value={d.sell}
                onValueChange={(sell) => set({ sell })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-cost`}>{t('lodging.rates.cost')}</Label>
              <MoneyInput
                id={`${id}-cost`}
                value={d.cost}
                onValueChange={(cost) => set({ cost })}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-min`}>{t('lodging.overrides.minNights')}</Label>
            <Input
              id={`${id}-min`}
              type="number"
              inputMode="numeric"
              min={1}
              max={60}
              className="w-28"
              value={d.minNights}
              aria-describedby={`${id}-min-hint`}
              onChange={(e) => set({ minNights: e.target.value })}
            />
            <p id={`${id}-min-hint`} className="text-xs text-muted-foreground">
              {t('lodging.overrides.minNightsHint')}
            </p>
          </div>
          {submitted && (invalid || overlap) && (
            <p role="alert" className="text-sm text-destructive">
              {t(invalid ? 'lodging.overrides.invalid' : 'lodging.overrides.overlap')}
            </p>
          )}
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
