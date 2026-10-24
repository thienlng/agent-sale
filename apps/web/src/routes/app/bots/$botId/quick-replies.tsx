import { createFileRoute } from '@tanstack/react-router';
import { TrainingItems } from '@/features/knowledge/components/training-items';
export const Route = createFileRoute('/app/bots/$botId/quick-replies')({
  component: function TrainingSection() {
    const { botId } = Route.useParams();
    return <TrainingItems botId={botId} kind="quick_reply" />;
  },
});
