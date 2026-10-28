import { createFileRoute } from '@tanstack/react-router';

import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { BotList } from '@/features/bot/components/bot-list';

export const Route = createFileRoute('/app/bots/')({
  component: BusinessBots,
});

function BusinessBots() {
  const workspace = useCurrentWorkspace();
  return (
    <BotList
      business={{
        workspace: workspace.data,
        status: workspace.status,
        onRetry: () => {
          void workspace.refetch();
        },
      }}
    />
  );
}
