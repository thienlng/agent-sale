import { useTranslation } from 'react-i18next';

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { groupWording } from '@/lib/industry-group';

export type CatalogMode = 'all' | 'selected';

/** Whether the bot sells every active product or only the products selected for it (T-080). */
export function BotCatalogMode({
  mode,
  onChange,
  disabled,
  industry,
}: {
  mode: CatalogMode;
  onChange: (mode: CatalogMode) => void;
  disabled?: boolean;
  /** The business's industry: a service business reads "dịch vụ" instead of "sản phẩm". */
  industry?: string | undefined;
}) {
  const { t } = useTranslation('training');
  const k = groupWording(industry, 'data.products', 'data.services');
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{t(k('modeLabel'))}</legend>
      <RadioGroup
        value={mode}
        onValueChange={(value) => onChange(value as CatalogMode)}
        disabled={disabled ?? false}
        className="grid gap-2 sm:grid-cols-2"
      >
        {(['all', 'selected'] as const).map((m) => (
          <label
            key={m}
            htmlFor={`catalog-mode-${m}`}
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary"
          >
            <RadioGroupItem id={`catalog-mode-${m}`} value={m} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">
                {t(m === 'all' ? k('modeAll') : k('modeSelected'))}
              </span>
              <span className="block text-xs text-muted-foreground">
                {t(m === 'all' ? k('modeAllHint') : k('modeSelectedHint'))}
              </span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </fieldset>
  );
}
