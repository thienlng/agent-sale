import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useApproveOrder } from '../api/commerce';
import { orderErrorMessage } from './order-errors';

/** The server accepts the undo only within this window, and only from the approving user. */
/** Shorter than the server's 5 s window so a late click never meets UNDO_NOT_ALLOWED. */
export const APPROVE_UNDO_MS = 4_000;

/**
 * Approves a pending bot order (optimistically) and offers "Hoàn tác" for 5 s, which sends the
 * same request with `approve:false`. Call it from a component that stays mounted (the list or
 * the detail page), not from a menu that closes.
 */
export function useApproveWithUndo() {
  const { t } = useTranslation();
  const mutation = useApproveOrder();

  const fail = (err: unknown) => toast.error(orderErrorMessage(t, err));

  // `mutateAsync`, not per-call `mutate` callbacks: those fire for the latest call only, and two
  // quick approvals must each get their own toast and undo.
  const undo = (order: { id: string; code: string }) =>
    mutation
      .mutateAsync({ id: order.id, approve: false })
      .then(() => toast(t('orders.review.undone', { code: order.code })), fail);

  const approve = (order: { id: string; code: string }) =>
    void mutation.mutateAsync({ id: order.id, approve: true }).then(() => {
      const until = Date.now() + APPROVE_UNDO_MS;
      toast.success(t('orders.review.approvedToast', { code: order.code }), {
        duration: APPROVE_UNDO_MS,
        action: {
          label: t('orders.review.undo'),
          // A hovered toast stays open past its duration; the window does not.
          onClick: () => {
            if (Date.now() <= until) void undo(order);
          },
        },
      });
    }, fail);

  return { approve, approving: mutation.isPending };
}
