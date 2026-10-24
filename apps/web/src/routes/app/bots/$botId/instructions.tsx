import { createFileRoute } from '@tanstack/react-router';
import { InstructionCards } from '@/features/bot/components/instruction-cards';
import { TrainingItems } from '@/features/knowledge/components/training-items';
export const Route = createFileRoute('/app/bots/$botId/instructions')({
  component: function TrainingSection() {
    const { botId } = Route.useParams();
    return (
      <TrainingItems
        botId={botId}
        kind="scenario"
        introduction={<InstructionCards botId={botId} />}
      />
    );
  },
});
