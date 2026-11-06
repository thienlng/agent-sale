import { Check } from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { useLodgingSettings, useUpdateLodgingSettings } from '../api/settings';

const MIN = 15;
const MAX = 1440;

/** "Giữ chỗ tự hết hạn sau N phút" (catalog managers; the caller checks the capability). */
export function HoldMinutesControl() {
  const { t } = useTranslation('lodging');
  const id = useId();
  const settings = useLodgingSettings();
  const update = useUpdateLodgingSettings();
  const stored = settings.data?.holdMinutes;
  const [text, setText] = useState('');
  useEffect(() => {
    if (stored !== undefined) setText(String(stored));
  }, [stored]);
  const minutes = Number(text);
  const valid = Number.isInteger(minutes) && minutes >= MIN && minutes <= MAX;
  const changed = stored !== undefined && valid && minutes !== stored;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || !changed || update.isPending) return;
    update.mutate(
      { holdMinutes: minutes },
      {
        onSuccess: () => toast.success(t('holdSetting.saved', { minutes }), { duration: 3500 }),
        onError: () => toast.error(t('holdSetting.error')),
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-center gap-2 text-sm">
      <Label htmlFor={id} className="font-normal text-muted-foreground">
        {t('holdSetting.label')}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={MIN}
        max={MAX}
        className="h-8 w-20 tabular-nums"
        value={text}
        disabled={stored === undefined}
        aria-invalid={(text !== '' && !valid) || undefined}
        aria-describedby={text !== '' && !valid ? `${id}-error` : undefined}
        onChange={(e) => setText(e.target.value)}
      />
      <span className="text-muted-foreground">{t('holdSetting.minutes')}</span>
      {changed && (
        <Button
          type="submit"
          size="icon-sm"
          variant="outline"
          aria-label={t('holdSetting.save')}
          disabled={update.isPending}
        >
          <Check aria-hidden />
        </Button>
      )}
      {text !== '' && !valid && (
        <span id={`${id}-error`} className="w-full text-xs text-destructive">
          {t('holdSetting.invalid')}
        </span>
      )}
    </form>
  );
}
