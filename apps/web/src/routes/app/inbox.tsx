import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import type { InboxConversation } from '@/features/conversation/lib/inbox-v2-types';
import { InboxPage } from '@/features/conversation/components/inbox-page';
import type { PanelSlots } from '@/features/conversation/components/conversation-view';
import { ProductShare } from '@/features/commerce/components/product-share';
import { CommentsWorkspace } from '@/features/channel/components/comments/comments-workspace';
import { DraftPrefill } from '@/features/brain/components/conversation-brain';
import { loadNamespace } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { InboxSalesPanel, type InboxCustomerContext } from './-components/inbox-sales-panel';

/**
 * `?conversation=` opens one conversation (links from a customer profile, T-088, and Today). A
 * reply drafted on Today waits in memory (`lib/pending-reply-draft`), never in the URL.
 */
const Search = z.object({
  conversation: z.uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/app/inbox')({
  validateSearch: Search,
  // The customer drawer of the sales panel shows the KiotViet badge and field hint, and a hotel's
  // panel lists the conversation's bookings. A failed load shows raw keys there instead of the
  // error page.
  loader: () =>
    Promise.allSettled([
      loadNamespace('integration'),
      loadNamespace('lodging'),
      loadNamespace('brain'),
    ]).then(() => undefined),
  component: InboxRoute,
});
function InboxRoute() {
  const session = useSession();
  const { conversation } = Route.useSearch();
  return (
    <SalesInbox
      key={`${session?.user.id}:${session?.workspaceId}:${conversation ?? ''}`}
      conversationId={conversation}
    />
  );
}
function SalesInbox({ conversationId }: { conversationId?: string | undefined }) {
  const [contexts, setContexts] = useState<Record<string, InboxCustomerContext>>({});
  return (
    <InboxPage
      renderComments={() => <CommentsWorkspace />}
      openConversationId={conversationId}
      renderComposerTools={(conversation, insertText) => (
        <>
          <DraftPrefill conversationId={conversation.id} insertText={insertText} />
          <ProductShare onInsert={insertText} />
        </>
      )}
      renderSalesPanel={(conversation: InboxConversation, slots: PanelSlots) => (
        <InboxSalesPanel
          key={conversation.id}
          conversation={conversation}
          slots={slots}
          value={contexts[conversation.id] ?? { orders: [] }}
          onOrderCreated={(order) =>
            setContexts((previous) => {
              const current = previous[conversation.id] ?? { orders: [] };
              return {
                ...previous,
                [conversation.id]: {
                  ...current,
                  created: order,
                  orders: [order, ...current.orders.filter((item) => item.id !== order.id)],
                },
              };
            })
          }
          onChange={(value) =>
            setContexts((previous) => ({ ...previous, [conversation.id]: value }))
          }
        />
      )}
    />
  );
}
