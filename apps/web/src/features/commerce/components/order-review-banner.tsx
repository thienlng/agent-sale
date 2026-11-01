import type { OrderSummaryDto } from '@agent-sales/contracts';
import { ArrowUpRight, Bot, Check, MessagesSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { useWorkspaceId } from '@/lib/use-workspace';

import { useApproveWithUndo } from '../hooks/use-approve-order';
import { conversationHref } from './order-created-by-cell';

/** "Mở hội thoại" as a labelled button-link; it always opens a new tab. */
function ConversationButton({
  conversationId,
  variant,
}: {
  conversationId: string;
  variant: 'outline' | 'link';
}) {
  const { t } = useTranslation();
  const workspaceId = useWorkspaceId();
  return (
    <Button variant={variant} size={variant === 'link' ? 'sm' : 'default'} asChild>
      <a
        href={conversationHref(conversationId, workspaceId)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {variant === 'outline' ? <MessagesSquare aria-hidden /> : null}
        {t('orders.review.openConversationShort')}
        <span className="sr-only"> {t('orders.review.newTab')}</span>
        <ArrowUpRight aria-hidden />
      </a>
    </Button>
  );
}

/**
 * Top of the order detail page for bot orders (spec §6.3): an amber call to review while
 * pending, a compact "approved by" line afterwards. Renders nothing for staff orders.
 */
export function OrderReviewBanner({
  order,
}: {
  order: Pick<
    OrderSummaryDto,
    | 'id'
    | 'code'
    | 'createdByKind'
    | 'reviewState'
    | 'reviewedByName'
    | 'reviewedAt'
    | 'conversationId'
  >;
}) {
  const { t } = useTranslation();
  const canManage = useCan('orders.manage');
  const { approve, approving } = useApproveWithUndo();
  if (order.createdByKind !== 'bot') return null;

  if (order.reviewState === 'pending') {
    return (
      <section
        aria-label={t('orders.review.bannerLabel')}
        className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3"
      >
        <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
          <Bot className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <p className="text-sm font-medium text-foreground">{t('orders.review.bannerPending')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? (
            <Button onClick={() => approve(order)} disabled={approving}>
              <Check aria-hidden />
              {approving ? t('orders.review.approving') : t('orders.review.approve')}
            </Button>
          ) : null}
          {order.conversationId ? (
            <ConversationButton conversationId={order.conversationId} variant="outline" />
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <Bot className="size-4 shrink-0" aria-hidden />
      <span>
        {order.reviewedByName && order.reviewedAt
          ? t('orders.review.bannerApproved', {
              name: order.reviewedByName,
              time: formatDateTime(order.reviewedAt),
            })
          : t('orders.review.bannerApprovedShort')}
      </span>
      {order.conversationId ? (
        <ConversationButton conversationId={order.conversationId} variant="link" />
      ) : null}
    </div>
  );
}
