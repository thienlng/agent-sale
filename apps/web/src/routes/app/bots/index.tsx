import { createFileRoute } from '@tanstack/react-router';

import { BotList } from '@/features/bot/components/bot-list';

export const Route = createFileRoute('/app/bots/')({
  component: () => (
    <div className="p-6 lg:p-10">
      <BotList />
    </div>
  ),
});
