import { useTranslation } from 'react-i18next';

import type { AvailabilityOptionData } from '../lib/calendar-model';
import { formatVnd } from '../lib/format';

/**
 * Tìm trống: the package the option's quote picked and the totals of the target's other
 * packages ("Gói 5PN · Gói khác: 4PN không bán, 6PN 30.000.000 ₫").
 */
export function FitPackages({ option }: { option: AvailabilityOptionData }) {
  const { t } = useTranslation('lodging');
  if (option.packages.length === 0) return null;
  const others = option.alternatives.map((a) =>
    a.totalSell === null
      ? t('find.alternativeNotSold', { name: a.name })
      : t('find.alternative', { name: a.name, amount: formatVnd(a.totalSell) }),
  );
  return (
    <div className="grid gap-0.5 px-2 pb-1 text-xs tabular-nums">
      <span className="font-medium">
        {t('find.package', { name: option.packages.map((k) => k.name).join(', ') })}
      </span>
      {others.length > 0 && (
        <span className="text-muted-foreground">
          {t('find.alternatives')}: {others.join(', ')}
        </span>
      )}
    </div>
  );
}
