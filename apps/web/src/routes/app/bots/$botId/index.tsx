import { createFileRoute } from '@tanstack/react-router';

import { SetupGuide } from '@/features/bot/components/setup-guide';
import { setupSteps } from '@/features/bot/utils/setup-steps';
import { useChannels } from '@/features/channel/api/channels';
import { useProducts } from '@/features/commerce/api/commerce';
import { useFaqs } from '@/features/knowledge/api/faqs';
import { useTrainingItems } from '@/features/knowledge/api/training';

/** Bot home: onboarding steps, each computed from the data its section owns. */
export const Route = createFileRoute('/app/bots/$botId/')({
  component: function Home() {
    const { botId } = Route.useParams();
    const channels = useChannels();
    const products = useProducts({ status: 'active', page: 1 });
    const items = useTrainingItems(botId);
    const faqs = useFaqs(botId);
    const steps = setupSteps({
      botId,
      channels: channels.data?.data ?? [],
      productCount: products.data?.total ?? 0,
      trainingKinds: (items.data ?? []).map((i) => i.kind),
      faqCount: faqs.data?.length ?? 0,
    });
    const loading = [channels, products, items, faqs].some((q) => q.isPending);
    return <SetupGuide botId={botId} steps={steps} loading={loading} />;
  },
});
