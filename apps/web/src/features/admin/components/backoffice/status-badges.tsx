import type { AccountStatus } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';

type SubStatus = 'trialing' | 'active' | 'past_due' | 'suspended' | 'canceled';

const SUB_VARIANT = {
  trialing: 'secondary',
  active: 'default',
  past_due: 'destructive',
  suspended: 'destructive',
  canceled: 'outline',
} as const;

/** `null` = no subscription row: the account is on the free plan. */
export function SubscriptionBadge({ status }: { status: SubStatus | null }) {
  const { t } = useTranslation('backoffice');
  if (!status) return <Badge variant="outline">{t('subStatus.free')}</Badge>;
  return <Badge variant={SUB_VARIANT[status]}>{t(`subStatus.${status}`)}</Badge>;
}

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const { t } = useTranslation('backoffice');
  return (
    <Badge variant={status === 'active' ? 'outline' : 'destructive'}>
      {t(`accountStatus.${status}`)}
    </Badge>
  );
}

export function PaymentStatusBadge({ status }: { status: 'pending' | 'confirmed' | 'canceled' }) {
  const { t } = useTranslation('backoffice');
  const variant =
    status === 'confirmed' ? 'default' : status === 'pending' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{t(`paymentStatus.${status}`)}</Badge>;
}
