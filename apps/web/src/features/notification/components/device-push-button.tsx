import { Smartphone, SmartphoneNfc } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import { isIosBrowserTab, usePushNotifications } from '../api/push';

/**
 * Header switch for notifications on this device (T-190): new customer messages for staff and the
 * bot's handovers, pushed even when Rapiz is closed. Hidden where push cannot work (unsupported
 * browser, server without push, or blocked in the browser settings).
 */
export function DevicePushButton() {
  const { t } = useTranslation();
  const { state, busy, enable, disable } = usePushNotifications();
  if (state === 'unconfigured' || state === 'denied') return null;
  if (state === 'unsupported') {
    // iPhone Safari: pushes need the app on the home screen first (the install button explains).
    return null;
  }
  const on = state === 'on';
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={busy}
      aria-pressed={on}
      aria-label={on ? t('pwa.push.turnOff') : t('pwa.push.turnOn')}
      title={on ? t('pwa.push.onHint') : t('pwa.push.offHint')}
      onClick={() => {
        if (on) {
          void disable().then(() => toast.success(t('pwa.push.disabled')));
          return;
        }
        void enable().then((ok) => {
          if (ok) toast.success(t('pwa.push.enabled'));
          else if (Notification.permission === 'denied') toast.error(t('pwa.push.blocked'));
          else if (isIosBrowserTab()) toast.info(t('pwa.install.iosHint'));
          else toast.error(t('pwa.push.failed'));
        });
      }}
    >
      {/* A phone, not a bell: the bell next to it is the account's notification list. */}
      {on ? (
        <SmartphoneNfc className="text-primary" />
      ) : (
        <Smartphone className="text-muted-foreground" />
      )}
    </Button>
  );
}
