import type { ProductDto } from '@agent-sales/contracts';
import { CircleAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';

import { useDeleteProduct, useSaveProduct, withStatus } from '../api/commerce';
import { productSaveErrorMessage } from '../hooks/lodging-errors';

type Refusal = 'product_in_orders' | 'product_synced';

function refusalOf(e: unknown): Refusal | null {
  if (!(e instanceof ApiClientError)) return null;
  const reason = e.details?.['reason'];
  return reason === 'product_in_orders' || reason === 'product_synced' ? reason : null;
}

/**
 * "Xoá sản phẩm" danger zone of the product page. Only a product no order uses can be deleted;
 * for one in orders the dialog says so and archives it in one click instead.
 */
export function DeleteProductSection({
  product: p,
  onDeleted,
  onArchived,
  service = false,
}: {
  product: ProductDto;
  /** A course or service of an education or spa business: worded as a service, not a product. */
  service?: boolean;
  /** Called after the delete (the page goes back to the catalog). */
  onDeleted: () => void;
  /** Called after "Lưu trữ" instead (the form shows the product archived). */
  onArchived?: () => void;
}) {
  const { t } = useTranslation();
  const k = (key: string) =>
    service
      ? [`products.service.delete.${key}`, `products.delete.${key}`]
      : `products.delete.${key}`;
  const remove = useDeleteProduct();
  const save = useSaveProduct();
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const label = `${p.code} · ${p.name}`;

  function close(next: boolean) {
    setOpen(next);
    if (!next) setRefusal(null);
  }

  function confirm() {
    remove.mutate(p.id, {
      onSuccess: () => {
        toast.success(t(k('deleted'), { name: label }));
        close(false);
        onDeleted();
      },
      onError: (err) => {
        const reason = refusalOf(err);
        if (reason) setRefusal(reason);
        else toast.error(errorMessage(t, err));
      },
    });
  }

  function archiveInstead() {
    save.mutate(
      { id: p.id, body: withStatus(p, 'archived') },
      {
        onSuccess: () => {
          toast.success(t(k('archivedDone'), { name: label }));
          close(false);
          onArchived?.();
        },
        onError: (err) => toast.error(productSaveErrorMessage(t, err)),
      },
    );
  }

  const message =
    refusal === 'product_synced'
      ? t(k('synced'))
      : p.status === 'archived'
        ? t(k('inOrdersArchived'))
        : t(k('inOrders'));

  return (
    <section
      aria-labelledby="delete-product-title"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 p-4 md:p-5"
    >
      <div className="min-w-0 flex-1 basis-64">
        <h2 id="delete-product-title" className="font-semibold">
          {t(k('title'))}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(k('hint'))}</p>
      </div>
      <Button type="button" variant="destructive" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden />
        {t(k('action'))}
      </Button>
      <AlertDialog open={open} onOpenChange={close}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(k('confirmTitle'), { name: label })}</AlertDialogTitle>
            <AlertDialogDescription>{t(k('confirmBody'))}</AlertDialogDescription>
          </AlertDialogHeader>
          {refusal ? (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel type="button">{t('common.cancel')}</AlertDialogCancel>
            {refusal ? (
              refusal === 'product_in_orders' && p.status === 'active' ? (
                <Button type="button" disabled={save.isPending} onClick={archiveInstead}>
                  {t(k('archiveInstead'))}
                </Button>
              ) : null
            ) : (
              <Button
                type="button"
                variant="destructive"
                disabled={remove.isPending}
                onClick={confirm}
              >
                {remove.isPending ? t(k('deleting')) : t(k('confirm'))}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
