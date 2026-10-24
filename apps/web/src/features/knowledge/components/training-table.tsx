import type { TrainingItemDto } from '@agent-sales/contracts';
import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { paginate } from '../utils/table-data';
import { DataPagination, tableFrame, tableHeadRow } from './data-page';

export function TrainingTable({
  items,
  kind,
  onEdit,
  onDelete,
}: {
  items: TrainingItemDto[];
  kind: 'scenario' | 'quick_reply';
  onEdit: (item: TrainingItemDto) => void;
  onDelete: (item: TrainingItemDto) => void;
}) {
  const { t, i18n } = useTranslation('training');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const current = paginate(items, page, pageSize);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className={cn(tableFrame, 'overflow-x-auto')}>
        <Table className="min-w-[440px]">
          <TableHeader>
            <TableRow className={tableHeadRow}>
              <TableHead className="w-12 text-center">{t('number')}</TableHead>
              <TableHead>{t(kind === 'scenario' ? 'situation' : 'shortcut')}</TableHead>
              {kind === 'quick_reply' ? <TableHead>{t('lastUpdated')}</TableHead> : null}
              <TableHead className="w-24 text-right">{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {current.items.map((item, index) => (
              <TableRow key={item.id}>
                <TableCell className="text-center text-xs text-muted-foreground">
                  {current.offset + index + 1}
                </TableCell>
                <TableCell className="max-w-sm whitespace-normal">
                  <button
                    type="button"
                    className="w-full text-left hover:text-primary focus-visible:underline"
                    onClick={() => onEdit(item)}
                  >
                    <h3 className="break-words font-medium">{item.title}</h3>
                    {item.trigger ? (
                      <p className="mt-1 break-words text-xs text-primary">{item.trigger}</p>
                    ) : null}
                    <p className="mt-1 line-clamp-2 break-words whitespace-pre-wrap text-xs text-muted-foreground">
                      {item.content}
                    </p>
                  </button>
                </TableCell>
                {kind === 'quick_reply' ? (
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(item.updatedAt).toLocaleDateString(i18n.language)}
                  </TableCell>
                ) : null}
                <TableCell>
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('edit')}
                      onClick={() => onEdit(item)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('delete')}
                      onClick={() => onDelete(item)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <DataPagination
        total={t(kind === 'scenario' ? 'data.instructions.total' : 'total', {
          count: items.length,
        })}
        page={current.page}
        pages={current.pages}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
    </div>
  );
}
