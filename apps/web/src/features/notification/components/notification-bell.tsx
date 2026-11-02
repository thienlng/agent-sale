import { Bell } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { loadNamespace } from '@/lib/i18n';

import { useUnreadCount } from '../api/notifications';

// The list and the `notification` namespace load on the first open (docs/16 §1).
const NotificationList = lazy(() =>
  Promise.all([import('./notification-list'), loadNamespace('notification')]).then(([m]) => ({
    default: m.NotificationList,
  })),
);

/** "9+" above nine; nothing at zero. */
export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? '9+' : String(count);
}

/**
 * The header bell (T-172, account owners): the unread count, and a popover with the newest
 * notifications. The count is one indexed query a minute and on window focus.
 */
export function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const count = unread.data ?? 0;
  const badge = badgeText(count);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={count > 0 ? t('app.notificationsUnread', { count }) : t('app.notifications')}
        >
          <Bell />
          {badge ? (
            <span
              data-testid="notification-badge"
              aria-hidden
              className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground"
            >
              {badge}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] gap-0 p-0">
        {open ? (
          <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">…</p>}>
            <NotificationList onDone={() => setOpen(false)} />
          </Suspense>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
