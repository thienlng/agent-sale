import type { ContactDto, ContactExternalLink } from '@agent-sales/contracts';
import { Lock, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';

// The strings live in the lazily loaded `integration` namespace (bundle budget, docs/16 §1); the
// routes that render customers load it.

export type ExternalSource = ContactExternalLink['source'];

/**
 * "KiotViet" on a customer linked to a KiotViet customer (spec §6.5), "Rapiz" on one linked to a
 * Rapiz account in the HQ business (ADR-021).
 */
export function KiotVietBadge({ contact }: { contact: Pick<ContactDto, 'external'> }) {
  const { t } = useTranslation('integration');
  if (!contact.external) return null;
  const rapiz = contact.external.source === 'rapiz';
  return (
    <Badge
      variant="outline"
      className="shrink-0"
      title={t(rapiz ? 'crm.rapizBadgeLabel' : 'crm.badgeLabel')}
    >
      {t(rapiz ? 'crm.rapizBadge' : 'crm.badge')}
    </Badge>
  );
}

/**
 * The note on the synced fields of a linked customer. KiotViet fields stay editable (sales staff
 * keep working on the profile) but the next KiotViet change overwrites them; the phone and email
 * of a Rapiz account are the link keys and read-only (ADR-021 §3).
 */
export function KiotVietFieldHint({ id, source }: { id: string; source: ExternalSource }) {
  const { t } = useTranslation('integration');
  const Icon = source === 'rapiz' ? Lock : RefreshCw;
  return (
    <p id={id} className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {t(source === 'rapiz' ? 'crm.rapizFieldHint' : 'crm.fieldHint')}
    </p>
  );
}
