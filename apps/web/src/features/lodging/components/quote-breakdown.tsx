import type { QuoteDto } from '@agent-sales/contracts';
import { TriangleAlert } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { dayMonth, formatVnd, nightList, weekdayShort } from '../lib/format';
import { bookingTotal, type PriceFields } from '../lib/party';

const parseMoney = (raw: string): number | null => {
  const digits = raw.replace(/[^\d-]/g, '');
  if (digits === '' || digits === '-') return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
};

/** Nightly table and surcharges of a quote. */
function QuoteLines({ quote }: { quote: QuoteDto }) {
  const { t } = useTranslation();
  return (
    <>
      {quote.nights.length > 0 && (
        <table className="w-full text-[13px] tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 text-left font-normal">{t('lodging.quote.date')}</th>
              <th className="py-1 text-left font-normal">{t('lodging.quote.weekday')}</th>
              <th className="py-1 text-left font-normal">{t('lodging.quote.label')}</th>
              <th className="py-1 text-right font-normal">{t('lodging.quote.sell')}</th>
            </tr>
          </thead>
          <tbody>
            {quote.nights.map((n) => (
              <tr key={n.date} className="border-t border-border">
                <td className="py-1">{dayMonth(n.date)}</td>
                <td className="py-1">{weekdayShort(t, n.date)}</td>
                <td className="py-1 text-muted-foreground">{n.label}</td>
                <td className="py-1 text-right">{formatVnd(n.sell)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {quote.surcharges.length > 0 && (
        <div className="grid gap-1">
          <p className="text-xs text-muted-foreground">{t('lodging.quote.surcharges')}</p>
          {quote.surcharges.map((s) => (
            <div key={s.kind} className="flex justify-between gap-2 tabular-nums">
              <span>{t(`lodging.quote.${s.kind}`, { persons: s.persons, nights: s.nights })}</span>
              <span>{formatVnd(s.sell)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Read-only price of a saved booking: stored quote, adjustment and total. */
export function QuoteSummary({
  quote,
  adjustment,
  adjustmentReason,
  totalSell,
}: {
  quote: QuoteDto | null;
  adjustment: number;
  adjustmentReason: string;
  totalSell: number | null;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 text-sm">
      {quote && <QuoteLines quote={quote} />}
      {adjustment !== 0 && (
        <div className="flex justify-between gap-2 tabular-nums">
          <span>
            {t('lodging.quote.adjustment')}
            {adjustmentReason && (
              <span className="text-muted-foreground"> · {adjustmentReason}</span>
            )}
          </span>
          <span>{formatVnd(adjustment)}</span>
        </div>
      )}
      <div className="flex items-baseline justify-between border-t border-border pt-2">
        <span className="text-muted-foreground">{t('lodging.quote.total')}</span>
        <span className="text-lg font-semibold tabular-nums">
          {totalSell === null ? t('lodging.quote.noTotal') : formatVnd(totalSell)}
        </span>
      </div>
    </div>
  );
}

/**
 * Nightly breakdown, surcharges, adjustment and total of a quote, with its warnings as
 * inline alerts. `manualRequired` (edit mode) asks for a new manual price or an explicit
 * "use the calculated price" choice.
 */
export function QuoteBreakdown({
  quote,
  loading,
  failed,
  checkIn,
  checkOut,
  standard,
  price,
  onPriceChange,
  manualRequired = false,
  useAuto = false,
  onUseAutoChange,
}: {
  quote: QuoteDto | undefined;
  loading: boolean;
  failed: boolean;
  checkIn: string;
  checkOut: string;
  standard: { adults: number; children: number } | null;
  price: PriceFields;
  onPriceChange: (next: PriceFields) => void;
  manualRequired?: boolean;
  useAuto?: boolean;
  onUseAutoChange?: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const priced = new Set(quote?.nights.map((n) => n.date));
  const missing = quote?.warnings.includes('missing_rate')
    ? nightList(checkIn, checkOut).filter((n) => !priced.has(n))
    : [];
  const total = bookingTotal(quote, price);

  return (
    <div className="grid gap-3 text-sm">
      {loading && !quote && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('lodging.quote.calculating')}
        </p>
      )}
      {failed && <p className="text-xs text-destructive">{t('lodging.quote.error')}</p>}
      {quote && <QuoteLines quote={quote} />}
      {quote?.warnings.map((w) => (
        <Alert key={w} className="border-warning/40 bg-warning-soft text-warning">
          <TriangleAlert aria-hidden />
          <AlertDescription className="text-warning">
            {t(`lodging.quote.warning.${w}`, {
              nights: missing.map(dayMonth).join(', '),
              adults: standard?.adults ?? 0,
              children: standard?.children ?? 0,
            })}
          </AlertDescription>
        </Alert>
      ))}

      <div className="grid gap-1">
        <Label htmlFor={`${id}-manual`} className="text-xs">
          {t('lodging.quote.manualTotal')}
        </Label>
        <Input
          id={`${id}-manual`}
          inputMode="numeric"
          className="h-8 tabular-nums"
          placeholder={quote && quote.totalSell !== null ? formatVnd(quote.totalSell) : ''}
          value={price.manualTotal ?? ''}
          disabled={useAuto}
          aria-invalid={(manualRequired && !useAuto && price.manualTotal === null) || undefined}
          onChange={(e) => {
            const n = parseMoney(e.target.value);
            onPriceChange({ ...price, manualTotal: n === null ? null : Math.max(0, n) });
          }}
        />
        {manualRequired ? (
          <div className="grid gap-1.5">
            <p className="text-xs text-destructive">{t('lodging.quote.manualRequired')}</p>
            <Label className="text-xs font-normal">
              <Checkbox checked={useAuto} onCheckedChange={(v) => onUseAutoChange?.(v === true)} />
              {t('lodging.quote.useAuto')}
            </Label>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('lodging.quote.manualHint')}</p>
        )}
      </div>
      <div className="grid grid-cols-[8rem_1fr] gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-adj`} className="text-xs">
            {t('lodging.quote.adjustment')}
          </Label>
          <Input
            id={`${id}-adj`}
            inputMode="numeric"
            className="h-8 tabular-nums"
            value={price.adjustment === 0 ? '' : price.adjustment}
            onChange={(e) =>
              onPriceChange({ ...price, adjustment: parseMoney(e.target.value) ?? 0 })
            }
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`${id}-reason`} className="text-xs">
            {t('lodging.quote.adjustmentReason')}
          </Label>
          <Input
            id={`${id}-reason`}
            className="h-8"
            maxLength={300}
            value={price.adjustmentReason}
            onChange={(e) => onPriceChange({ ...price, adjustmentReason: e.target.value })}
          />
        </div>
      </div>
      <div className="flex items-baseline justify-between border-t border-border pt-2">
        <span className="text-muted-foreground">{t('lodging.quote.total')}</span>
        <span className="text-lg font-semibold tabular-nums" data-testid="quote-total">
          {total === null ? t('lodging.quote.noTotal') : formatVnd(total)}
        </span>
      </div>
    </div>
  );
}
