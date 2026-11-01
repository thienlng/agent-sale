import type { BookingStatus } from '@agent-sales/contracts';
import { Ban, CalendarCheck, Clock, LogIn, LogOut, Lock, LockOpen, UserX } from 'lucide-react';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Status look shared by the grid bars, the badges and the mobile month grid. Every
 * status has text and an icon or pattern, never colour alone (ui-design-notes).
 */
export const STATUS_STYLE: Record<
  BookingStatus,
  { className: string; icon: ComponentType<{ className?: string }> }
> = {
  hold: { className: 'bg-stripes-warning text-warning border-warning/40', icon: Clock },
  confirmed: {
    className: 'bg-primary-soft text-primary-strong border-primary/30',
    icon: CalendarCheck,
  },
  checked_in: {
    className: 'bg-primary/25 text-primary-strong border-primary/50 font-semibold',
    icon: LogIn,
  },
  checked_out: { className: 'bg-muted text-muted-foreground border-border', icon: LogOut },
  active: {
    className: 'bg-hatch-muted text-muted-foreground border-muted-foreground/40',
    icon: Lock,
  },
  cancelled: { className: 'bg-muted text-muted-foreground border-border line-through', icon: Ban },
  expired: { className: 'bg-muted text-muted-foreground border-border', icon: Clock },
  no_show: { className: 'bg-destructive-soft text-destructive border-destructive/30', icon: UserX },
  removed: { className: 'bg-muted text-muted-foreground border-border', icon: LockOpen },
};

export function BookingStatusBadge({
  status,
  className,
}: {
  status: BookingStatus;
  className?: string;
}) {
  const { t } = useTranslation();
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <Badge variant="outline" className={cn('gap-1', style.className, className)}>
      <Icon className="size-3" aria-hidden />
      {t(`lodging.bookingStatus.${status}`)}
    </Badge>
  );
}
