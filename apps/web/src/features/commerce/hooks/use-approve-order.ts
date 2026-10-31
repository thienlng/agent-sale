import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useApproveOrder } from '../api/commerce';
import { orderErrorMessage } from './order-errors';

/** The server accepts the undo only within this window, and only from the approving user. */
export const APPROVE_UNDO_MS = 5_000;

/**
 * Approves a pending bot order (optimistically) and offers "Hoàn tác" for 5 s, which sends the
 * same request with `approve:false`. Call it from a component that stays mounted (the list or
 * the detail page), not from a menu that closes.
 */
export function useApproveWithUndo() {
  const { t } = useTranslation();
  const mutation = useApproveOrder();

  const approve = (order: { id: string; code: string }) =>
    mutation.mutate(
      { id: order.id, approve: true },
      {
        onSuccess: () => {
          const until = Date.now() + APPROVE_UNDO_MS;
          toast.success(t('orders.review.approvedToast', { code: order.code }), {
            duration: APPROVE_UNDO_MS,
            action: {
              label: t('orders.review.undo'),
              onClick: () => {
                // A hovered toast stays open past its duration; the window does not.
                if (Date.now() > until) return;
                mutation.mutate(
                  { id: order.id, approve: false },
                  {
                    onSuccess: () => toast(t('orders.review.undone', { code: order.code })),
                    onError: (err) => toast.error(orderErrorMessage(t, err)),
                  },
                );
              },
            },
          });
        },
        onError: (err) => toast.error(orderErrorMessage(t, err)),
      },
    );

  return { approve, approving: mutation.isPending };
}
