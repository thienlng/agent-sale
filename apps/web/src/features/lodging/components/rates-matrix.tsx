import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { MoneyInput } from '@/components/money-input';
import { cn } from '@/lib/utils';

import { type RateCell, type RateRow, WEEKDAYS } from '../lib/rates-model';

/** Accessible name of a row: the target, plus the package for a package row. */
export const rowTitle = (row: RateRow) =>
  row.packageKey ? `${row.name} · ${row.packageName}` : row.name;

/**
 * Weekday price table: one row per target (whole place / room), or per package of a
 * target with packages (most bedrooms first), one column per day T2…CN, each cell a sell
 * input over a smaller cost input; a narrow column names the two lines ("Giá bán" /
 * "Giá nhập") so the second line is not read as a duplicate. A package row shows its
 * name, with the target and "Gói đầy đủ" under it; an empty day of a package that is
 * not the full one reads "Không bán". Rows that miss a price show the days right under
 * the row, and their empty sell inputs are marked invalid.
 */
export function RatesMatrix({
  rows,
  errors,
  disabled,
  onChange,
}: {
  rows: RateRow[];
  /** Row key → missing weekdays (only after a save attempt). */
  errors: Map<string, number[]>;
  disabled: boolean;
  onChange: (key: string, cells: RateCell[]) => void;
}) {
  const { t } = useTranslation('lodging');
  const day = (d: number) => t(`weekdayShort.${d}`);
  const setCell = (row: RateRow, d: number, patch: Partial<RateCell>) =>
    onChange(
      row.key,
      row.cells.map((c, k) => (k === d - 1 ? { ...c, ...patch } : c)),
    );
  const severalTargets = new Set(rows.map((r) => r.unitId)).size > 1;
  const targetLabel = (row: RateRow) =>
    row.wholeOptional
      ? t('rates.wholeOptional')
      : row.inactive
        ? t('rates.roomInactive', { name: row.name })
        : row.name;
  const subLabel = (row: RateRow) =>
    [severalTargets ? targetLabel(row) : '', row.full ? t('packages.full') : '']
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[1000px] border-collapse text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="w-48 px-3 py-2 text-left font-medium">
              {t('rates.target')}
            </th>
            <th scope="col" className="w-20 px-1.5 py-2">
              <span className="sr-only">{t('rates.priceKind')}</span>
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
            const missing = errors.get(row.key) ?? [];
            const errorId = `rates-row-${i}-error`;
            const title = rowTitle(row);
            const sub = row.packageKey ? subLabel(row) : '';
            const notSold = row.fill === 'any';
            return (
              <Fragment key={row.key}>
                <tr className={cn('border-t align-top', row.inactive && 'text-muted-foreground')}>
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {row.packageKey ? (
                      <>
                        <span className="flex min-h-8 items-center break-words">
                          {row.packageName || t('packages.unnamed')}
                        </span>
                        {sub && (
                          <span className="mt-1 flex min-h-7 items-center text-xs font-normal text-muted-foreground">
                            {sub}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="flex min-h-8 items-center break-words">
                        {targetLabel(row)}
                      </span>
                    )}
                  </th>
                  <td className="px-1.5 py-2 text-xs text-muted-foreground" aria-hidden>
                    <span className="flex h-8 items-center font-medium text-foreground">
                      {t('rates.sell')}
                    </span>
                    <span className="mt-1 flex h-7 items-center">{t('rates.cost')}</span>
                  </td>
                  {WEEKDAYS.map((d) => {
                    const cell = row.cells[d - 1] ?? { sell: 0, cost: 0 };
                    const invalid = missing.includes(d);
                    return (
                      <td key={d} className={cn('px-1.5 py-2', d >= 6 && 'bg-muted/30')}>
                        <MoneyInput
                          aria-label={t('rates.sellLabel', { row: title, day: day(d) })}
                          aria-invalid={invalid || undefined}
                          aria-describedby={invalid ? errorId : undefined}
                          placeholder={notSold ? t('packages.notSold') : t('rates.sell')}
                          disabled={disabled}
                          value={cell.sell}
                          onValueChange={(sell) => setCell(row, d, { sell })}
                          className="h-8 bg-background px-2 text-sm"
                        />
                        <MoneyInput
                          aria-label={t('rates.costLabel', { row: title, day: day(d) })}
                          placeholder={
                            cell.sell
                              ? new Intl.NumberFormat('vi-VN').format(cell.sell)
                              : notSold
                                ? '—'
                                : t('rates.cost')
                          }
                          disabled={disabled}
                          value={cell.cost}
                          onValueChange={(cost) => setCell(row, d, { cost })}
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
                        {t('rates.missing', {
                          row: title,
                          days: missing.map(day).join(', '),
                        })}
                      </p>
                      {!row.packageKey && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {t('rates.missingHint')}
                        </p>
                      )}
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
