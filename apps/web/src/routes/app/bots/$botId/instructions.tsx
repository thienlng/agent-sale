import { createFileRoute } from '@tanstack/react-router';
import { PersonalityCard } from '@/features/knowledge/components/personality-card';
import { RulesList } from '@/features/knowledge/components/rules-list';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
export const Route = createFileRoute('/app/bots/$botId/instructions')({
  component: function TrainingSection() {
    const { botId } = Route.useParams();
    const workspace = useCurrentWorkspace();
    return (
      <RulesList
        botId={botId}
        industry={workspace.data?.industry}
        introduction={<PersonalityCard botId={botId} />}
      />
    );
  },
});
