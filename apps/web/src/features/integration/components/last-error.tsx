import { CircleAlert, KeyRound, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

import { useLogMessage } from './sync-log-list';

/**
 * The connection's last error with the one action that fixes it: new credentials when KiotViet
 * rejected the secret, disconnect (then connect again) when the connect step failed.
 */
export function LastError({
  code,
  fix,
  onFix,
}: {
  code: string;
  /** The action the error card offers, if the viewer may take it. */
  fix: 'credentials' | 'disconnect' | null;
  onFix: () => void;
}) {
  const { t } = useTranslation('integration');
  const message = useLogMessage();
  const text =
    code === 'kiotviet_unavailable'
      ? t('wizard.errors.unavailable')
      : message({ code, params: {} });
  return (
    <Alert variant="destructive" className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <CircleAlert className="hidden sm:block" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <AlertTitle>{t('connection.lastErrorTitle')}</AlertTitle>
        <AlertDescription>{text}</AlertDescription>
      </div>
      {fix === 'credentials' ? (
        <AlertAction className="static">
          <Button className="h-11 w-full sm:w-auto" onClick={onFix}>
            <KeyRound aria-hidden />
            {t('connection.updateCredentials')}
          </Button>
        </AlertAction>
      ) : null}
      {fix === 'disconnect' ? (
        <AlertAction className="static">
          <Button variant="destructive" className="h-11 w-full sm:w-auto" onClick={onFix}>
            <Unplug aria-hidden />
            {t('connection.danger')}
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}
