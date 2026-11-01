import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api-client';

import { lodgingConflict } from '../api/bookings';

/**
 * A failed booking write: `NIGHTS_TAKEN` names the bookings in the way (or a generic line
 * when the race path sends no codes), `STALE_VERSION` offers a reload, `HOLD_EXPIRED` says the
 * hold lapsed, a 400 on
 * `manualTotalSell` asks for the total price.
 */
export function BookingErrorAlert({ error, onReload }: { error: unknown; onReload?: () => void }) {
  const { t } = useTranslation();
  if (!error) return null;
  const conflict = lodgingConflict(error);
  let text: string;
  if (conflict.reason === 'NIGHTS_TAKEN')
    text = conflict.codes.length
      ? t('lodging.nightsTaken', { codes: conflict.codes.join(', ') })
      : t('lodging.nightsTakenUnknown');
  else if (conflict.reason === 'STALE_VERSION') text = t('lodging.staleVersion');
  else if (conflict.reason === 'HOLD_EXPIRED') text = t('lodging.holdExpired');
  else if (
    error instanceof ApiClientError &&
    error.status === 400 &&
    error.details?.['field'] === 'manualTotalSell'
  )
    // A night has no price (the server sends the quote warnings) or the stay changed under a
    // manual price: either way the total must be typed.
    text = Array.isArray(error.details?.['warnings'])
      ? t('lodging.quote.missingPrice')
      : t('lodging.quote.manualRequired');
  else if (error instanceof ApiClientError && error.code === 'FORBIDDEN')
    text = t('lodging.sheet.permission');
  else text = t('lodging.sheet.saveError');
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription className="flex flex-wrap items-center gap-2">
        <span>{text}</span>
        {conflict.reason === 'STALE_VERSION' && onReload && (
          <Button type="button" size="xs" variant="outline" onClick={onReload}>
            {t('lodging.sheet.reload')}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
