import type { WarehouseDto } from '@agent-sales/contracts';
import { Plus, Star, Trash2, Warehouse } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';

import { useDeleteWarehouse, useSaveWarehouse, useWarehouses } from '../api/commerce';

type Draft = { name: string; phone: string; province: string; ward: string; addressDetail: string };
const empty: Draft = { name: '', phone: '', province: '', ward: '', addressDetail: '' };

/** Warehouses (ORD-02): sender details for carriers; one default. */
export function WarehousesManager() {
  const { t } = useTranslation();
  const warehouses = useWarehouses();
  const save = useSaveWarehouse();
  const remove = useDeleteWarehouse();
  const [editing, setEditing] = useState<WarehouseDto | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(empty);
  const [deleting, setDeleting] = useState<WarehouseDto | null>(null);

  const edit = (w: WarehouseDto | null) => {
    setEditing(w);
    setDraft(
      w
        ? {
            name: w.name,
            phone: w.phone ?? '',
            province: w.province ?? '',
            ward: w.ward ?? '',
            addressDetail: w.addressDetail ?? '',
          }
        : empty,
    );
    setOpen(true);
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate(
      { ...(editing ? { id: editing.id } : {}), body: draft },
      {
        onSuccess: () => {
          toast.success(t('warehouses.saved'));
          setOpen(false);
        },
        onError: (err) => toast.error(errorMessage(t, err)),
      },
    );
  }

  const field = (
    key: keyof Draft,
    label: string,
    opts: { required?: boolean; type?: string } = {},
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`wh-${key}`}>{label}</Label>
      <Input
        id={`wh-${key}`}
        required={opts.required}
        type={opts.type ?? 'text'}
        maxLength={key === 'addressDetail' ? 300 : 120}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('warehouses.hint')}</p>
        <Button onClick={() => edit(null)}>
          <Plus />
          {t('warehouses.add')}
        </Button>
      </div>
      {warehouses.isPending ? (
        <Skeleton className="h-32 rounded-xl" />
      ) : !warehouses.data?.length ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          {t('warehouses.empty')}
        </p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {warehouses.data.map((w) => (
            <li key={w.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
                  <Warehouse className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{w.name}</span>
                    {w.isDefault ? (
                      <Badge variant="secondary">{t('warehouses.default')}</Badge>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-sm text-muted-foreground">
                    {[w.addressDetail, w.ward, w.province].filter(Boolean).join(', ') || '—'}
                  </div>
                  {w.phone ? <div className="text-sm tabular-nums">{w.phone}</div> : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => edit(w)}>
                  {t('orderDetail.edit')}
                </Button>
                {!w.isDefault ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        save.mutate(
                          {
                            id: w.id,
                            body: {
                              name: w.name,
                              phone: w.phone,
                              province: w.province,
                              ward: w.ward,
                              addressDetail: w.addressDetail,
                              isDefault: true,
                            },
                          },
                          { onError: (err) => toast.error(errorMessage(t, err)) },
                        )
                      }
                    >
                      <Star />
                      {t('warehouses.makeDefault')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setDeleting(w)}
                    >
                      <Trash2 />
                      {t('warehouses.delete')}
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{editing ? editing.name : t('warehouses.add')}</DialogTitle>
              <DialogDescription>{t('warehouses.hint')}</DialogDescription>
            </DialogHeader>
            {field('name', t('warehouses.name'), { required: true })}
            {field('phone', t('warehouses.phone'), { type: 'tel' })}
            <div className="grid gap-4 sm:grid-cols-2">
              {field('province', t('warehouses.province'))}
              {field('ward', t('warehouses.ward'))}
            </div>
            {field('addressDetail', t('warehouses.addressDetail'))}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {t('warehouses.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('warehouses.deleteConfirm', { name: deleting?.name ?? '' })}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!deleting) return;
                remove.mutate(deleting.id, {
                  onSuccess: () => toast.success(t('warehouses.deleted')),
                  onError: (err) => toast.error(errorMessage(t, err)),
                });
                setDeleting(null);
              }}
            >
              {t('warehouses.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
