import { createFileRoute } from '@tanstack/react-router';
import { IntroductionRows } from '@/features/bot/components/instruction-cards';
import { RulesList } from '@/features/knowledge/components/rules-list';
export const Route = createFileRoute('/app/bots/$botId/instructions')({
  component: function TrainingSection() {
    const { botId } = Route.useParams();
    return <RulesList botId={botId} introduction={<IntroductionRows botId={botId} />} />;
  },
});
