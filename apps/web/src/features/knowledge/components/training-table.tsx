import type { TrainingItemDto } from '@agent-sales/contracts';
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = items.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  return (
    <div className="min-w-0 space-y-3">
      <div className="overflow-hidden rounded-lg border">
        <Table className="min-w-[440px]">
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead className="w-12 text-center">{t('number')}</TableHead>
              <TableHead>{t(kind === 'scenario' ? 'situation' : 'shortcut')}</TableHead>
              {kind === 'quick_reply' ? <TableHead>{t('lastUpdated')}</TableHead> : null}
              <TableHead className="w-24 text-right">{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((item, index) => (
              <TableRow key={item.id} className="odd:bg-muted/30">
                <TableCell className="text-center text-xs text-muted-foreground">
                  {(currentPage - 1) * pageSize + index + 1}
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
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          {t('page', { page: currentPage, pages })}
        </span>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            setPageSize(Number(value));
            setPage(1);
          }}
        >
          <SelectTrigger aria-label={t('pageSize')} className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 20, 50].map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('previous')}
          disabled={currentPage <= 1}
          onClick={() => setPage(currentPage - 1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('next')}
          disabled={currentPage >= pages}
          onClick={() => setPage(currentPage + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
