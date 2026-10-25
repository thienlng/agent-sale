import { createFileRoute } from '@tanstack/react-router';

import { ActionPage } from '@/features/action/components/action-page';

export const Route = createFileRoute('/app/bots/$botId/actions/new')({
  component: function NewActionPage() {
    const { botId } = Route.useParams();
    return <ActionPage botId={botId} />;
  },
});
