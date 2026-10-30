import type { FaqDto } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { placeholderLabel } from '@/lib/placeholders';
import { cn } from '@/lib/utils';

import { tableHeadRow } from './data-page';

const PLACEHOLDER = /(\{\{\s*[a-z][a-z0-9_.]*\s*\}\})/g;

/** Shows `{{store.address}}` as a readable token ("Địa chỉ") instead of template syntax. */
function AnswerText({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <>
      {text.split(PLACEHOLDER).map((part, i) =>
        i % 2 === 1 ? (
          <span
            key={i}
            className="mx-0.5 rounded bg-primary-soft px-1 py-px text-sm font-medium text-accent-foreground"
          >
            {placeholderLabel(t, part.replace(/[{}\s]/g, ''))}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** One page of FAQs: row number turns into a checkbox on hover or when anything is selected. */
export function FaqTable({
  rows,
  offset,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
}: {
  rows: FaqDto[];
  offset: number;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onOpen: (faq: FaqDto) => void;
}) {
  const { t } = useTranslation();
  const { t: tr } = useTranslation('training');
  const pageSelected = rows.filter((f) => selected.has(f.id)).length;
  const all = rows.length > 0 && pageSelected === rows.length;
  const selecting = selected.size > 0;
  return (
    <Table className="min-w-[640px] table-fixed">
      <TableHeader>
        <TableRow className={tableHeadRow}>
          <TableHead className="w-16 text-center">
            <Checkbox
              checked={all ? true : pageSelected ? 'indeterminate' : false}
              onCheckedChange={(checked) => onToggleAll(checked === true)}
              aria-label={tr('data.faq.selectAll')}
            />
          </TableHead>
          <TableHead>{tr('data.faq.colQuestion')}</TableHead>
          <TableHead className="text-right">{tr('data.faq.colAnswer')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((faq, index) => {
          const checked = selected.has(faq.id);
          const number = offset + index + 1;
          return (
            <TableRow
              key={faq.id}
              data-state={checked ? 'selected' : undefined}
              className="group cursor-pointer"
              onClick={() => onOpen(faq)}
            >
              <TableCell className="text-center align-middle" onClick={(e) => e.stopPropagation()}>
                {checked || selecting ? null : (
                  <span
                    className="text-xs text-muted-foreground group-hover:hidden group-has-[:focus-visible]:hidden"
                    aria-hidden
                  >
                    {number}
                  </span>
                )}
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => onToggle(faq.id)}
                  aria-label={tr('data.faq.selectRow', { index: number })}
                  className={cn(
                    'mx-auto',
                    !(checked || selecting) &&
                      'sr-only group-hover:not-sr-only focus-visible:not-sr-only',
                  )}
                />
              </TableCell>
              <TableCell className="whitespace-normal">
                <button
                  type="button"
                  className="text-left break-words hover:text-primary focus-visible:underline focus-visible:outline-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(faq);
                  }}
                >
                  - {faq.question}
                </button>
                {faq.missingPlaceholders.length ? (
                  <Badge
                    variant="secondary"
                    className="mt-1.5 flex w-fit bg-warning-soft text-warning"
                  >
                    {t('faq.missing')}
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className="whitespace-normal break-words text-sm">
                <span className="line-clamp-4">
                  <AnswerText text={faq.answer} />
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
