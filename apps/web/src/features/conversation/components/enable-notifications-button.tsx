import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useNotificationPermission } from '../hooks/use-lead-alerts';

/** Asks once for the browser's notification permission; hidden when granted, denied or unsupported. */
export function EnableNotificationsButton() {
  const { t } = useTranslation();
  const { permission, request } = useNotificationPermission();
  if (permission !== 'default') return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 shrink-0 gap-1 px-2 text-xs"
      title={t('channelInbox.v2.notifications.enableHint')}
      onClick={request}
    >
      <Bell className="size-3.5" aria-hidden />
      {t('channelInbox.v2.notifications.enable')}
    </Button>
  );
}
