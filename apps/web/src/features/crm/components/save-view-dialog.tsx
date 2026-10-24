import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

/** Name and visibility of a new saved view. */
export function SaveViewDialog({
  open,
  onOpenChange,
  onSave,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (v: { name: string; visibility: 'private' | 'shared' }) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'shared'>('private');
  // Every save starts blank.
  useEffect(() => {
    if (open) {
      setName('');
      setVisibility('private');
    }
  }, [open]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSave({ name: name.trim(), visibility });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('crm.views.save')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sv-name">{t('crm.views.name')}</Label>
            <Input
              id="sv-name"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t('crm.views.visibility')}</legend>
            <RadioGroup
              value={visibility}
              onValueChange={(v) => setVisibility(v as 'private' | 'shared')}
            >
              {(['private', 'shared'] as const).map((v) => (
                <div key={v} className="flex items-center gap-2">
                  <RadioGroupItem id={`sv-${v}`} value={v} />
                  <Label htmlFor={`sv-${v}`} className="font-normal">
                    {t(v === 'private' ? 'crm.views.private' : 'crm.views.sharedOption')}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
          <DialogFooter>
            <Button type="submit" disabled={pending || !name.trim()}>
              {t('crm.views.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
