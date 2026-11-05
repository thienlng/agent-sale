import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { MoneyInput } from '@/components/money-input';
import { cn } from '@/lib/utils';

import { type RateRow, WEEKDAYS } from '../lib/rates-model';

/**
 * Weekday price table: one row per target (whole place / room), one column per day
 * T2…CN, each cell a sell input over a smaller cost input; a narrow column names the
 * two lines ("Giá bán" / "Giá nhập") so the second line is not read as a duplicate. Rows that miss a price show
 * the days right under the row, and their empty sell inputs are marked invalid.
 */
export function RatesMatrix({
  rows,
  errors,
  disabled,
  onChange,
}: {
  rows: RateRow[];
  /** Row index → missing weekdays (only after a save attempt or a blur). */
  errors: Map<number, number[]>;
  disabled: boolean;
  onChange: (rows: RateRow[]) => void;
}) {
  const { t } = useTranslation();
  const day = (d: number) => t(`lodging.weekdayShort.${d}`);
  const setRow = (i: number, row: RateRow) => onChange(rows.map((r, j) => (j === i ? row : r)));
  const setCell = (i: number, d: number, patch: Partial<{ sell: number; cost: number }>) => {
    const row = rows[i];
    if (!row) return;
    setRow(i, {
      ...row,
      cells: row.cells.map((c, k) => (k === d - 1 ? { ...c, ...patch } : c)),
    });
  };
  const label = (row: RateRow) =>
    row.unitId === null && !row.required
      ? t('lodging.rates.wholeOptional')
      : row.inactive
        ? t('lodging.rates.roomInactive', { name: row.name })
        : row.name;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[1000px] border-collapse text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="w-48 px-3 py-2 text-left font-medium">
              {t('lodging.rates.target')}
            </th>
            <th scope="col" className="w-20 px-1.5 py-2">
              <span className="sr-only">{t('lodging.rates.priceKind')}</span>
            </th>
            {WEEKDAYS.map((d) => (
              <th
                key={d}
                scope="col"
                className={cn('py-2 pr-3.5 pl-1.5 text-right font-medium', d >= 6 && 'bg-muted/60')}
              >
                {day(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const missing = errors.get(i) ?? [];
            const errorId = `rates-row-${i}-error`;
            return (
              <Fragment key={row.unitId ?? 'whole'}>
                <tr className={cn('border-t align-top', row.inactive && 'text-muted-foreground')}>
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    <span className="flex min-h-8 items-center break-words">{label(row)}</span>
                  </th>
                  <td className="px-1.5 py-2 text-xs text-muted-foreground" aria-hidden>
                    <span className="flex h-8 items-center font-medium text-foreground">
                      {t('lodging.rates.sell')}
                    </span>
                    <span className="mt-1 flex h-7 items-center">{t('lodging.rates.cost')}</span>
                  </td>
                  {WEEKDAYS.map((d) => {
                    const cell = row.cells[d - 1] ?? { sell: 0, cost: 0 };
                    const invalid = missing.includes(d);
                    return (
                      <td key={d} className={cn('px-1.5 py-2', d >= 6 && 'bg-muted/30')}>
                        <MoneyInput
                          aria-label={t('lodging.rates.sellLabel', { row: row.name, day: day(d) })}
                          aria-invalid={invalid || undefined}
                          aria-describedby={invalid ? errorId : undefined}
                          placeholder={t('lodging.rates.sell')}
                          disabled={disabled}
                          value={cell.sell}
                          onValueChange={(sell) => setCell(i, d, { sell })}
                          className="h-8 bg-background px-2 text-sm"
                        />
                        <MoneyInput
                          aria-label={t('lodging.rates.costLabel', { row: row.name, day: day(d) })}
                          placeholder={
                            cell.sell
                              ? new Intl.NumberFormat('vi-VN').format(cell.sell)
                              : t('lodging.rates.cost')
                          }
                          disabled={disabled}
                          value={cell.cost}
                          onValueChange={(cost) => setCell(i, d, { cost })}
                          className="mt-1 h-7 bg-background px-2 text-xs text-muted-foreground"
                        />
                      </td>
                    );
                  })}
                </tr>
                {missing.length > 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 pb-2">
                      <p id={errorId} className="text-xs text-destructive">
                        {t('lodging.rates.missing', {
                          row: row.name,
                          days: missing.map(day).join(', '),
                        })}
                      </p>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
