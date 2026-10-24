import { createFileRoute } from '@tanstack/react-router';

import { ReadinessChecklist } from '@/features/bot/components/readiness-checklist';

export const Route = createFileRoute('/app/bots/$botId/')({
  component: function Overview() {
    const { botId } = Route.useParams();
    return (
      <div className="mx-auto w-full max-w-2xl">
        <ReadinessChecklist botId={botId} />
      </div>
    );
  },
});
