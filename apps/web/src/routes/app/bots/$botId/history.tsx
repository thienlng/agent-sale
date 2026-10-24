import { createFileRoute } from '@tanstack/react-router';
import { TrainingHistory } from '@/features/knowledge/components/training-history';
export const Route = createFileRoute('/app/bots/$botId/history')({
  component: function HistoryPage() {
    const { botId } = Route.useParams();
    return <TrainingHistory botId={botId} />;
  },
});
