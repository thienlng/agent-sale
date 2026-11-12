import { createFileRoute } from '@tanstack/react-router';

import { ActionAccess } from '@/features/action/components/action-access';
import { ActionPage } from '@/features/action/components/action-page';

export const Route = createFileRoute('/app/bots/$botId/actions/new')({
  component: function NewActionPage() {
    const { botId } = Route.useParams();
    return (
      <ActionAccess>
        <ActionPage botId={botId} />
      </ActionAccess>
    );
  },
});
