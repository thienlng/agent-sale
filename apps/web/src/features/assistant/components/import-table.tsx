import type { ImportDraftDto } from '@agent-sales/contracts';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { formatVnd } from '@/lib/format';

/** `cut:name` → `cut`; `invalid:variants.0.price` → `invalid`. */
const baseCode = (code: string): string => code.split(':', 1)[0] ?? code;

/** The owner-facing text of a problem or result code (`assistant.import.problem.<code>`). */
export function problemLabel(t: TFunction<'assistant'>, code: string): string {
  return t(`import.problem.${baseCode(code)}` as never, { defaultValue: code }) as string;
}

/** `150.000 ₫` or `100.000 ₫ – 250.000 ₫`; empty when no variant has a price. */
export function priceText(draft: ImportDraftDto): string {
  const prices = (draft.product?.variants ?? [])
    .map((v) => v.price)
    .filter((p): p is number => p !== null);
  if (prices.length === 0) return '';
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi ? formatVnd(lo) : `${formatVnd(lo)} – ${formatVnd(hi)}`;
}

function stockText(draft: ImportDraftDto): string {
  const stocks = (draft.product?.variants ?? [])
    .map((v) => v.stock)
    .filter((s): s is number => s !== null);
  return stocks.length ? String(stocks.reduce((a, b) => a + b, 0)) : '';
}

/** The drafts an import would create: name, code, price, variants, stock and warning badges. */
export function ImportTable({ drafts }: { drafts: readonly ImportDraftDto[] }) {
  const { t } = useTranslation('assistant');
  return (
    <div className="max-h-72 overflow-auto rounded-md border bg-background">
      <table className="w-full text-xs">
        <caption className="sr-only">{t('import.table.caption')}</caption>
        <thead className="sticky top-0 bg-muted text-left">
          <tr>
            <th scope="col" className="px-2 py-1 font-medium">
              {t('import.table.name')}
            </th>
            <th scope="col" className="px-2 py-1 font-medium">
              {t('import.table.code')}
            </th>
            <th scope="col" className="px-2 py-1 font-medium">
              {t('import.table.price')}
            </th>
            <th scope="col" className="px-2 py-1 text-right font-medium">
              {t('import.table.variants')}
            </th>
            <th scope="col" className="px-2 py-1 text-right font-medium">
              {t('import.table.stock')}
            </th>
            <th scope="col" className="px-2 py-1 font-medium">
              {t('import.table.warnings')}
            </th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((d) => (
            <tr key={d.key} className="border-t align-top">
              <td className="px-2 py-1 break-words">{d.product?.name}</td>
              <td className="px-2 py-1 font-mono break-all">{d.product?.code}</td>
              <td className="px-2 py-1 whitespace-nowrap">{priceText(d)}</td>
              <td className="px-2 py-1 text-right">{d.product?.variants.length ?? 0}</td>
              <td className="px-2 py-1 text-right">{stockText(d)}</td>
              <td className="px-2 py-1">
                <span className="flex flex-wrap gap-1">
                  {d.problems
                    .filter((p) => p.severity === 'warning')
                    .map((p) => (
                      <Badge
                        key={`${p.field}:${p.code}:${p.row ?? ''}`}
                        variant="outline"
                        title={problemLabel(t, p.code)}
                        className="font-normal"
                      >
                        {problemLabel(t, p.code)}
                      </Badge>
                    ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
