import { createFileRoute } from '@tanstack/react-router';
import { BotIntegrations } from '@/features/channel/components/bot-integrations';

export const Route = createFileRoute('/app/bots/$botId/integrations')({
  component: function IntegrationsPage() {
    const { botId } = Route.useParams();
    return <BotIntegrations botId={botId} />;
  },
});
