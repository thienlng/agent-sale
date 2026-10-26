import { createFileRoute } from '@tanstack/react-router';

import { ActionList } from '@/features/action/components/action-list';

export const Route = createFileRoute('/app/bots/$botId/actions/')({
  component: function ActionsPage() {
    const { botId } = Route.useParams();
    return <ActionList botId={botId} />;
  },
});
