import { createFileRoute } from '@tanstack/react-router';

import { Skeleton } from '@/components/ui/skeleton';
import { useBot } from '@/features/bot/api/bots';
import { AdsTool } from '@/features/bot/components/ads-tool';

export const Route = createFileRoute('/app/bots/$botId/ads-tool')({
  component: function AdsToolPage() {
    const { botId } = Route.useParams();
    const bot = useBot(botId);
    return bot.data ? <AdsTool bot={bot.data} /> : <Skeleton className="h-96 rounded-xl" />;
  },
});
