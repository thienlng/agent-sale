import type { ConnectionStatus } from '@agent-sales/contracts';
import { CircleAlert, CircleCheck, LoaderCircle, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const LOOK: Record<ConnectionStatus, { icon: LucideIcon; className: string }> = {
  connected: { icon: CircleCheck, className: 'bg-success-soft text-success' },
  syncing: { icon: LoaderCircle, className: 'bg-primary/10 text-brand-text' },
  error: { icon: CircleAlert, className: 'bg-destructive/10 text-destructive' },
  disconnected: { icon: CircleAlert, className: 'bg-muted text-muted-foreground' },
};

/** Connection state as icon + text, never colour alone. */
export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const { t } = useTranslation('integration');
  const { icon: Icon, className } = LOOK[status];
  return (
    <Badge variant="secondary" className={cn('gap-1', className)}>
      <Icon aria-hidden className={cn(status === 'syncing' && 'motion-safe:animate-spin')} />
      {t(`connection.status.${status}`)}
    </Badge>
  );
}
