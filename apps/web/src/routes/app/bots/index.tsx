import { createFileRoute } from '@tanstack/react-router';

import { BotList } from '@/features/bot/components/bot-list';

export const Route = createFileRoute('/app/bots/')({
  component: () => <BotList />,
});
