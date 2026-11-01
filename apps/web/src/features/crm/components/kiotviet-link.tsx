import type { ContactDto } from '@agent-sales/contracts';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';

// The strings live in the lazily loaded `integration` namespace (bundle budget, docs/16 §1); the
// routes that render customers load it.

/** "KiotViet" on a customer linked to a KiotViet customer (spec §6.5). */
export function KiotVietBadge({ contact }: { contact: Pick<ContactDto, 'external'> }) {
  const { t } = useTranslation('integration');
  if (!contact.external) return null;
  return (
    <Badge variant="outline" className="shrink-0" title={t('crm.badgeLabel')}>
      {t('crm.badge')}
    </Badge>
  );
}

/**
 * The note on the KiotViet-owned fields of a linked customer. They stay editable (sales staff
 * keep working on the profile), but the next KiotViet change overwrites them.
 */
export function KiotVietFieldHint({ id }: { id: string }) {
  const { t } = useTranslation('integration');
  return (
    <p id={id} className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
      <RefreshCw aria-hidden className="size-3.5 shrink-0" />
      {t('crm.fieldHint')}
    </p>
  );
}
