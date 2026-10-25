import type { ConversationDto } from '@agent-sales/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { InboxPage } from '@/features/conversation/components/inbox-page';
import { ProductShare } from '@/features/commerce/components/product-share';
import { useSession } from '@/lib/session';
import { InboxSalesPanel, type InboxCustomerContext } from './-components/inbox-sales-panel';

export const Route = createFileRoute('/app/inbox')({ component: InboxRoute });
function InboxRoute() {
  const session = useSession();
  return <SalesInbox key={`${session?.user.id}:${session?.workspaceId}`} />;
}
function SalesInbox() {
  const [contexts, setContexts] = useState<Record<string, InboxCustomerContext>>({});
  return (
    <InboxPage
      renderComposerTools={(_conversation, insertText) => <ProductShare onInsert={insertText} />}
      renderSalesPanel={(conversation: ConversationDto) => (
        <InboxSalesPanel
          key={conversation.id}
          conversation={conversation}
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
