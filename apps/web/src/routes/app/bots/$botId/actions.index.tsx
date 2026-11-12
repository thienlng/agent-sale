import { createFileRoute } from '@tanstack/react-router';

import { ActionAccess } from '@/features/action/components/action-access';
import { ActionList } from '@/features/action/components/action-list';

export const Route = createFileRoute('/app/bots/$botId/actions/')({
  component: function ActionsPage() {
    const { botId } = Route.useParams();
    return (
      <ActionAccess>
        <ActionList botId={botId} />
      </ActionAccess>
    );
  },
});
