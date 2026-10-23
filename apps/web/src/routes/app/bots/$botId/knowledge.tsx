import { createFileRoute } from '@tanstack/react-router';

import { FaqList } from '@/features/knowledge/components/faq-list';

export const Route = createFileRoute('/app/bots/$botId/knowledge')({
  component: function Knowledge() {
    const { botId } = Route.useParams();
    return <FaqList botId={botId} />;
  },
});
