import type { KiotVietTestResponse } from '@agent-sales/contracts';
import { CircleAlert, Info, LoaderCircle } from 'lucide-react';
import type { FormEvent } from 'react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatNumber } from '@/lib/format';

type Preview = KiotVietTestResponse['preview'];

/** The preview sentence; a capped scan says how many codes it looked at (controller ruling). */
export function usePreviewSentence() {
  const { t } = useTranslation('integration');
  return (p: Preview) => {
    const partial = p.total !== null && p.scanned < p.total;
    const counts = {
      matched: formatNumber(p.matched),
      created: formatNumber(p.created),
      rapizOnly: formatNumber(p.rapizOnly),
      scanned: formatNumber(p.scanned),
      total: p.total === null ? '' : formatNumber(p.total),
    };
    return partial ? t('wizard.previewPartial', counts) : t('wizard.preview', counts);
  };
}

/** Toggles that ship in PR 2/3: shown on and locked, with a "Sắp có" badge. */
export function ComingSoonToggles() {
  const { t } = useTranslation('integration');
  const id = useId();
  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {(['pushOrders', 'syncCustomers'] as const).map((key) => (
        <li key={key} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
          <span className="flex flex-wrap items-center gap-2">
            <Label htmlFor={`${id}-${key}`}>{t(`wizard.${key}`)}</Label>
            <Badge variant="secondary">{t('wizard.soon')}</Badge>
          </span>
          <Switch id={`${id}-${key}`} checked disabled />
        </li>
      ))}
    </ul>
  );
}

/** Step 3: what the first sync will do, then start it. */
export function WizardReviewStep({
  result,
  banner,
  starting,
  onBack,
  onStart,
}: {
  result: KiotVietTestResponse;
  banner: string | null;
  starting: boolean;
  onBack: () => void;
  onStart: () => void;
}) {
  const { t } = useTranslation('integration');
  const sentence = usePreviewSentence();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!starting) onStart();
  };
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      {banner ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{banner}</AlertDescription>
        </Alert>
      ) : null}
      <section className="flex flex-col gap-1.5 rounded-lg bg-muted/50 p-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          {t('wizard.previewTitle')} · {t('wizard.store', { retailer: result.retailer })}
        </h3>
        <p className="text-base font-medium tabular-nums">{sentence(result.preview)}</p>
      </section>
      <ComingSoonToggles />
      <Alert role="note">
        <Info />
        <AlertDescription>{t('wizard.sourceNote')}</AlertDescription>
      </Alert>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="h-11"
          disabled={starting}
          onClick={onBack}
        >
          {t('wizard.back')}
        </Button>
        <Button type="submit" size="lg" className="h-11" disabled={starting}>
          {starting ? <LoaderCircle aria-hidden className="motion-safe:animate-spin" /> : null}
          {t('wizard.start')}
        </Button>
      </div>
    </form>
  );
}
