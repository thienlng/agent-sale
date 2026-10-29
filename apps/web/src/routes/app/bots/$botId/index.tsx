import { createFileRoute } from '@tanstack/react-router';

import { BotStatistics } from '@/features/analytics/components/bot-statistics';
import { SetupGuide } from '@/features/bot/components/setup-guide';
import { profileProgress, setupSteps } from '@/features/bot/utils/setup-steps';
import { useChannels } from '@/features/channel/api/channels';
import { useProducts } from '@/features/commerce/api/commerce';
import { useBotProfile } from '@/features/knowledge/api/bot-profile';
import { useFaqs } from '@/features/knowledge/api/faqs';
import { useTrainingItems } from '@/features/knowledge/api/training';

/**
 * Bot home: onboarding steps, each computed from the data its section owns, then the bot's figures.
 * Analytics facts carry the page, so the bot's figures are those of the pages assigned to it.
 */
export const Route = createFileRoute('/app/bots/$botId/')({
  component: function Home() {
    const { botId } = Route.useParams();
    const channels = useChannels();
    const products = useProducts({ status: 'active', page: 1 });
    const items = useTrainingItems(botId);
    const faqs = useFaqs(botId);
    const bot = useBotProfile(botId);
    const steps = setupSteps({
      botId,
      channels: channels.data?.data ?? [],
      productCount: products.data?.total ?? 0,
      trainingKinds: (items.data ?? []).map((i) => i.kind),
      faqCount: faqs.data?.length ?? 0,
      profile: profileProgress(bot.data?.industry ?? '', bot.data?.settings.profile.fields ?? {}),
    });
    const loading = [channels, products, items, faqs, bot].some((q) => q.isPending);
    const pageIds = channels.data?.data.filter((c) => c.botId === botId).map((c) => c.id);
    return (
      <div className="flex flex-col gap-8">
        <SetupGuide botId={botId} steps={steps} loading={loading} />
        <BotStatistics botId={botId} pageIds={pageIds} />
      </div>
    );
  },
});
