import { useTranslation } from 'react-i18next';

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** The mandatory "why" of every operator action (ADR-021 §6). */
export function ReasonField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation('backoffice');
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t('common.reason')}</Label>
      <Textarea
        id={id}
        value={value}
        required
        maxLength={500}
        rows={2}
        placeholder={t('common.reasonPlaceholder')}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {t('common.reasonHint')}
      </p>
    </div>
  );
}
