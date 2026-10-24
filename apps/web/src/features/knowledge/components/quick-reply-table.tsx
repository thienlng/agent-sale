import type { TrainingItemDto } from '@agent-sales/contracts';
import { Pencil, Trash2 } from 'lucide-react';
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
import { formatDateTime } from '@/lib/format';

import { displayShortcut } from '../utils/quick-replies';
import { tableHeadRow } from './data-page';

export function QuickReplyTable({
  rows,
  onEdit,
  onDelete,
}: {
  rows: TrainingItemDto[];
  onEdit: (item: TrainingItemDto) => void;
  onDelete: (item: TrainingItemDto) => void;
}) {
  const { t } = useTranslation('training');
  return (
    <Table className="min-w-[720px]">
      <TableHeader>
        <TableRow className={tableHeadRow}>
          <TableHead className="w-44">{t('data.quick.colShortcut')}</TableHead>
          <TableHead>{t('data.quick.colContent')}</TableHead>
          <TableHead className="w-40 text-center">{t('data.quick.colUpdated')}</TableHead>
          <TableHead className="w-28 text-center">{t('data.quick.colImage')}</TableHead>
          <TableHead className="w-24 text-center">{t('data.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((item) => {
          const shortcut = displayShortcut(item);
          return (
            <TableRow key={item.id}>
              <TableCell className="font-medium break-all whitespace-normal text-primary">
                {shortcut}
              </TableCell>
              <TableCell className="whitespace-normal">
                <span className="line-clamp-3 break-words whitespace-pre-wrap">{item.content}</span>
              </TableCell>
              <TableCell className="text-center text-sm text-muted-foreground tabular-nums">
                {formatDateTime(item.updatedAt)}
              </TableCell>
              <TableCell className="text-center">
                {item.mediaUrl ? (
                  <a
                    href={item.mediaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mx-auto block size-12 overflow-hidden rounded-md border bg-muted"
                  >
                    <img
                      src={item.mediaUrl}
                      alt={shortcut}
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  </a>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex justify-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('data.edit')} ${shortcut}`}
                    onClick={() => onEdit(item)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t('data.delete')} ${shortcut}`}
                    onClick={() => onDelete(item)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
