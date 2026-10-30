import { createFileRoute } from '@tanstack/react-router';
import { PersonalityCard } from '@/features/knowledge/components/personality-card';
import { RulesList } from '@/features/knowledge/components/rules-list';
export const Route = createFileRoute('/app/bots/$botId/instructions')({
  component: function TrainingSection() {
    const { botId } = Route.useParams();
    return <RulesList botId={botId} introduction={<PersonalityCard botId={botId} />} />;
  },
});
