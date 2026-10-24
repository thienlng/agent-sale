import type { OrderStatus } from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { useBulkChangeStatus } from '../api/commerce';

/** Appears while orders are selected: change their status in one go. */
export function OrdersBulkBar({
  selected,
  statuses,
  requireNote,
  onDone,
}: {
  selected: string[];
  statuses: readonly OrderStatus[];
  requireNote: ReadonlySet<string>;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const bulk = useBulkChangeStatus();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [note, setNote] = useState('');
  const needsNote = status !== '' && requireNote.has(status);

  if (!selected.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-primary-soft px-3 py-2 text-sm">
      <span className="font-medium text-accent-foreground">
        {t('orders.bulk.selected', { count: selected.length })}
      </span>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t('orders.bulk.changeStatus')}
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        {t('orders.bulk.clear')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('orders.bulk.title', { count: selected.length })}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bulk-status">{t('orders.col.status')}</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus)}>
              <SelectTrigger id="bulk-status" className="w-full">
                <SelectValue placeholder={t('orders.bulk.pick')} />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`status.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bulk-note">
              {needsNote ? t('orderDetail.noteRequired') : t('orderDetail.note')}
            </Label>
            <Textarea
              id="bulk-note"
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!status || bulk.isPending || (needsNote && !note.trim())}
              onClick={() =>
                status &&
                bulk.mutate(
                  {
                    ids: selected,
                    body: { status, ...(note.trim() ? { note: note.trim() } : {}) },
                  },
                  {
                    onSuccess: ({ ok, total }) => {
                      (ok === total ? toast.success : toast.warning)(
                        t('orders.bulk.done', { ok, total }),
                      );
                      setOpen(false);
                      setNote('');
                      setStatus('');
                      onDone();
                    },
                  },
                )
              }
            >
              {bulk.isPending
                ? t('settings.saving')
                : t('orders.bulk.apply', { count: selected.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
