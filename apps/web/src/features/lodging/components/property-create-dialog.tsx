import type { SellMode } from '@agent-sales/contracts';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';

import { useCreateProperty } from '../api/properties';
import { SavingLabel } from './booking-fields';
import { Field, intOrNull } from './property-tab-parts';

/** "Thêm căn": code, name, sell mode and standard guests; then opens the editor. */
export function PropertyCreateDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const navigate = useNavigate();
  const create = useCreateProperty();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sellMode, setSellMode] = useState<SellMode>('whole');
  const [adults, setAdults] = useState('2');
  const [children, setChildren] = useState('0');
  const [submitted, setSubmitted] = useState(false);
  const errors = {
    code: !/^[A-Za-z0-9-]{1,20}$/.test(code.trim()),
    name: !name.trim(),
    adults: (intOrNull(adults) ?? 0) < 1,
    children: (intOrNull(children) ?? -1) < 0,
  };
  const show = (key: keyof typeof errors) =>
    submitted && errors[key] ? t('lodging.places.required') : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean) || create.isPending) return;
    create.mutate(
      {
        code: code.trim(),
        name: name.trim(),
        sellMode,
        standardAdults: intOrNull(adults) ?? 1,
        standardChildren: intOrNull(children) ?? 0,
      },
      {
        onSuccess: (p) => {
          toast.success(t('lodging.places.created', { code: p.code }), { duration: 3500 });
          onClose();
          void navigate({ to: '/app/properties/$propertyId', params: { propertyId: p.id } });
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiClientError && error.code === 'CONFLICT'
              ? t('lodging.places.codeTaken')
              : error instanceof ApiClientError && error.code === 'VALIDATION_FAILED'
                ? t('lodging.places.error')
                : errorMessage(t, error),
          ),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('lodging.places.createTitle')}</DialogTitle>
          <DialogDescription>{t('lodging.places.createDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <Field
              id={`${id}-code`}
              label={t('lodging.places.code')}
              hint={t('lodging.places.codeHint')}
              error={show('code')}
            >
              <Input
                id={`${id}-code`}
                value={code}
                maxLength={20}
                autoComplete="off"
                aria-invalid={Boolean(show('code')) || undefined}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            <Field id={`${id}-name`} label={t('lodging.places.name')} error={show('name')}>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={200}
                aria-invalid={Boolean(show('name')) || undefined}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{t('lodging.places.sellMode')}</legend>
            <RadioGroup value={sellMode} onValueChange={(v) => setSellMode(v as SellMode)}>
              {(['whole', 'rooms'] as const).map((mode) => (
                <div key={mode} className="flex items-start gap-2">
                  <RadioGroupItem id={`${id}-${mode}`} value={mode} className="mt-0.5" />
                  <Label htmlFor={`${id}-${mode}`} className="grid gap-0.5 font-normal">
                    <span className="font-medium">{t(`lodging.sellMode.${mode}`)}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(
                        mode === 'whole'
                          ? 'lodging.places.sellModeWholeHint'
                          : 'lodging.places.sellModeRoomsHint',
                      )}
                    </span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
          <div className="grid grid-cols-2 gap-4">
            <Field
              id={`${id}-adults`}
              label={t('lodging.places.standardAdults')}
              error={show('adults')}
            >
              <Input
                id={`${id}-adults`}
                type="number"
                min={1}
                value={adults}
                onChange={(e) => setAdults(e.target.value)}
              />
            </Field>
            <Field
              id={`${id}-children`}
              label={t('lodging.places.standardChildren')}
              error={show('children')}
            >
              <Input
                id={`${id}-children`}
                type="number"
                min={0}
                value={children}
                onChange={(e) => setChildren(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              <SavingLabel saving={create.isPending}>{t('lodging.places.submit')}</SavingLabel>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
