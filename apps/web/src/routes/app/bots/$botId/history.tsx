import { createFileRoute } from '@tanstack/react-router';

import { EditHistory } from '@/features/bot/components/edit-history';

export const Route = createFileRoute('/app/bots/$botId/history')({
  component: function HistoryPage() {
    const { botId } = Route.useParams();
    return <EditHistory botId={botId} />;
  },
});
