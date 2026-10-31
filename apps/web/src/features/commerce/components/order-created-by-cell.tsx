import type { OrderSummaryDto } from '@agent-sales/contracts';
import { ArrowUpRight, Bot, Check, MessagesSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export type OrderOrigin = Pick<
  OrderSummaryDto,
  | 'createdByKind'
  | 'createdByName'
  | 'reviewState'
  | 'reviewedByName'
  | 'reviewedAt'
  | 'conversationId'
>;

/** The inbox deep link that opens one conversation. */
export const conversationHref = (conversationId: string) =>
  `/app/inbox?conversation=${encodeURIComponent(conversationId)}`;

/**
 * "Mở hội thoại": opens the conversation the bot took the order in, in a new tab, without also
 * firing the row click underneath.
 */
export function OpenConversationLink({
  conversationId,
  className,
}: {
  conversationId: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = t('orders.review.openConversation');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={conversationHref(conversationId)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'icon' }),
            'gap-0 text-muted-foreground hover:text-primary',
            className,
          )}
        >
          <MessagesSquare className="size-4" aria-hidden />
          <ArrowUpRight className="-ml-0.5 size-3 self-start" aria-hidden />
        </a>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** "Bot" with its icon: who created the order, never shown by colour alone. */
export function BotBadge() {
  const { t } = useTranslation();
  return (
    <Badge className="bg-primary-soft text-accent-foreground">
      <Bot aria-hidden />
      {t('orders.review.bot')}
    </Badge>
  );
}

/** Amber "Chờ duyệt" chip: a dot plus text, so the state reads without colour. */
export function PendingReviewChip() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-full bg-warning-soft px-2 text-xs font-medium whitespace-nowrap text-amber-900 dark:text-amber-200">
      <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
      {t('orders.review.pending')}
    </span>
  );
}

function ApprovedChip({ order }: { order: OrderOrigin }) {
  const { t } = useTranslation();
  const chip = (focusable: boolean) => (
    <span
      tabIndex={focusable ? 0 : undefined}
      className="inline-flex h-5 items-center gap-1 rounded-full bg-muted px-2 text-xs font-medium whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <Check className="size-3" aria-hidden />
      {t('orders.review.approved')}
    </span>
  );
  // Right after an optimistic approve the reviewer is not known yet.
  if (!order.reviewedByName || !order.reviewedAt) return chip(false);
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip(true)}</TooltipTrigger>
      <TooltipContent>
        {t('orders.review.approvedBy', {
          name: order.reviewedByName,
          time: formatDateTime(order.reviewedAt),
        })}
      </TooltipContent>
    </Tooltip>
  );
}

/** A bot order from the dashboard test chat has no customer conversation to open: say so. */
function TestChatChip() {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex h-5 items-center rounded-full border border-dashed px-2 text-xs whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t('orders.review.testChat')}
        </span>
      </TooltipTrigger>
      <TooltipContent>{t('orders.review.testChatHint')}</TooltipContent>
    </Tooltip>
  );
}

/**
 * "Người tạo": the staff name, or for bot orders the Bot badge, the review state and a link to
 * the conversation (spec §6.1), or "Chat thử" when the order came from the test chat.
 */
export function OrderCreatedByCell({ order }: { order: OrderOrigin }) {
  if (order.createdByKind !== 'bot') {
    return (
      <span className="block truncate" title={order.createdByName ?? undefined}>
        {order.createdByName ?? '—'}
      </span>
    );
  }
  return (
    <div className="-my-1.5 flex flex-wrap items-center gap-1.5">
      <BotBadge />
      {order.reviewState === 'pending' ? <PendingReviewChip /> : <ApprovedChip order={order} />}
      {order.conversationId ? (
        <OpenConversationLink conversationId={order.conversationId} />
      ) : (
        <TestChatChip />
      )}
    </div>
  );
}
