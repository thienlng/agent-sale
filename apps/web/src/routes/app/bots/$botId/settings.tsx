import { createFileRoute } from '@tanstack/react-router';

import { Skeleton } from '@/components/ui/skeleton';
import { useBot } from '@/features/bot/api/bots';
import { BotSettingsForm } from '@/features/bot/components/bot-settings-form';

export const Route = createFileRoute('/app/bots/$botId/settings')({
  component: function Settings() {
    const { botId } = Route.useParams();
    const bot = useBot(botId);
    return bot.data ? (
      <BotSettingsForm key={bot.data.id} bot={bot.data} />
    ) : (
      <Skeleton className="h-96 rounded-xl" />
    );
  },
});
