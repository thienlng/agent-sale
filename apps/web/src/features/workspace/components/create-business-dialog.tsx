import { type FormEvent, useState } from 'react';
import { Industry } from '@agent-sales/contracts';
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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useBusinessSwitch } from '@/hooks/use-business-switch';
import { ApiClientError } from '@/lib/api-client';
import { reloadSession } from '@/lib/session';

import { useCreateBusiness } from '../api/create-business';

const TEMPLATES = Industry.options;

function createErrorKey(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'FORBIDDEN') return 'business.create.errors.forbidden';
    if (error.status === 400 || error.status === 422) return 'business.create.errors.validation';
  }
  return 'business.create.errors.generic';
}

/**
 * Creates a business (name + template), then selects it and lands on its statistics home.
 * The template is chosen once here and is read-only afterwards.
 */
export function CreateBusinessDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const create = useCreateBusiness();
  const { choose } = useBusinessSwitch();
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<Industry | ''>('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const trimmed = name.trim();
  const canSubmit = !busy && !created && trimmed.length > 0 && template !== '';

  function changeOpen(next: boolean) {
    if (busy) return;
    if (!next) {
      setName('');
      setTemplate('');
      setCreated(false);
      setErrorKey(null);
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErrorKey(null);
    try {
      const business = await create.mutateAsync({ name: trimmed, industry: template });
      setCreated(true);
      try {
        await reloadSession();
        if (!(await choose(business.id))) throw new Error('not switched');
      } catch {
        // The business exists; resubmitting would create a duplicate.
        setErrorKey('business.create.errors.loadError');
        return;
      }
      setBusy(false);
      changeOpen(false);
    } catch (error) {
      setErrorKey(createErrorKey(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={(e) => void submit(e)} className="flex min-w-0 flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('business.create.title')}</DialogTitle>
            <DialogDescription>{t('business.create.description')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="create-business-name">{t('business.create.name')}</Label>
            <Input
              id="create-business-name"
              required
              maxLength={120}
              autoComplete="off"
              placeholder={t('business.create.namePlaceholder')}
              value={name}
              disabled={busy || created}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <fieldset className="flex min-w-0 flex-col gap-2" disabled={busy || created}>
            <legend className="text-sm font-medium">{t('business.create.template')}</legend>
            <p className="text-sm text-muted-foreground">{t('business.create.templateHint')}</p>
            <RadioGroup
              value={template}
              onValueChange={(value) => setTemplate(value as Industry)}
              className="grid gap-2 sm:grid-cols-2"
              aria-label={t('business.create.template')}
            >
              {TEMPLATES.map((key) => (
                <label
                  key={key}
                  htmlFor={`business-template-${key}`}
                  className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-accent has-[[aria-checked=true]]:border-primary has-[[aria-checked=true]]:bg-accent"
                >
                  <RadioGroupItem
                    id={`business-template-${key}`}
                    value={key}
                    className="mt-0.5"
                    aria-labelledby={`business-template-${key}-label`}
                    aria-describedby={`business-template-${key}-hint`}
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span id={`business-template-${key}-label`} className="text-sm font-medium">
                      {t(`industries.${key}`)}
                    </span>
                    <span
                      id={`business-template-${key}-hint`}
                      className="text-xs break-words text-muted-foreground"
                    >
                      {t(`business.create.templates.${key}`)}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>
          {errorKey ? (
            <p role="alert" className="text-sm text-destructive">
              {t(errorKey)}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => changeOpen(false)}>
              {t('business.create.cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? t('business.create.submitting') : t('business.create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
