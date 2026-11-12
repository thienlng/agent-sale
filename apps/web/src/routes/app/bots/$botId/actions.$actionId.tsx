import { createFileRoute } from '@tanstack/react-router';

import { ActionAccess } from '@/features/action/components/action-access';
import { ActionPage } from '@/features/action/components/action-page';

export const Route = createFileRoute('/app/bots/$botId/actions/$actionId')({
  component: function EditActionPage() {
    const { botId, actionId } = Route.useParams();
    return (
      <ActionAccess>
        <ActionPage botId={botId} actionId={actionId} />
      </ActionAccess>
    );
  },
});
