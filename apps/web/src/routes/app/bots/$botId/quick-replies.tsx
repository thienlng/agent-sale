import { createFileRoute } from '@tanstack/react-router';

import { QuickReplyList } from '@/features/knowledge/components/quick-reply-list';

export const Route = createFileRoute('/app/bots/$botId/quick-replies')({
  component: function QuickRepliesPage() {
    const { botId } = Route.useParams();
    return <QuickReplyList botId={botId} />;
  },
});
