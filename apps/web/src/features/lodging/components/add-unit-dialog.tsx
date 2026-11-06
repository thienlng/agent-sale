import {
  type UnitCategory,
  UnitCategory as UnitCategoryEnum,
  type UnitInput,
} from '@agent-sales/contracts';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { SavingLabel } from './booking-fields';
import { Field, intOrNull } from './property-tab-parts';

/** Name, type and standard party of a new unit; the rest is entered on its page. */
export function AddUnitDialog({
  pending,
  onClose,
  onAdd,
}: {
  pending: boolean;
  onClose: () => void;
  onAdd: (unit: UnitInput) => void;
}) {
  const { t } = useTranslation('lodging');
  const id = useId();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<UnitCategory>('room');
  const [adults, setAdults] = useState('2');
  const [children, setChildren] = useState('0');
  const [submitted, setSubmitted] = useState(false);
  const a = intOrNull(adults);
  const c = intOrNull(children || '0');
  const errors = {
    name: !name.trim() ? t('units.errors.nameRequired') : undefined,
    adults: a === null || a < 1 || a > 100 ? t('units.errors.adultsInvalid') : undefined,
    children: c === null || c < 0 || c > 100 ? t('units.errors.childrenInvalid') : undefined,
  };
  const show = (key: keyof typeof errors) => (submitted ? errors[key] : undefined);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean) || pending) return;
    onAdd({
      name: name.trim(),
      category,
      capacityAdults: a ?? 1,
      capacityChildren: c ?? 0,
      active: true,
    });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t('units.addTitle')}</DialogTitle>
            <DialogDescription>{t('units.addDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <Field id={`${id}-name`} label={t('units.name')} error={show('name')}>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={100}
                autoFocus
                aria-invalid={show('name') ? true : undefined}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field id={`${id}-category`} label={t('units.kind')}>
              <Select value={category} onValueChange={(v) => setCategory(v as UnitCategory)}>
                <SelectTrigger id={`${id}-category`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UnitCategoryEnum.options.map((k) => (
                    <SelectItem key={k} value={k}>
                      {t(`units.category.${k}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field id={`${id}-adults`} label={t('units.standardAdults')} error={show('adults')}>
              <Input
                id={`${id}-adults`}
                type="number"
                inputMode="numeric"
                min={1}
                value={adults}
                aria-invalid={show('adults') ? true : undefined}
                onChange={(e) => setAdults(e.target.value)}
              />
            </Field>
            <Field
              id={`${id}-children`}
              label={t('units.standardChildren')}
              error={show('children')}
            >
              <Input
                id={`${id}-children`}
                type="number"
                inputMode="numeric"
                min={0}
                value={children}
                aria-invalid={show('children') ? true : undefined}
                onChange={(e) => setChildren(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('media.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              <SavingLabel saving={pending}>{t('units.addSubmit')}</SavingLabel>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
