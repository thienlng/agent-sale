import { createFileRoute, Link } from '@tanstack/react-router';
import { BookOpen, Boxes, Plug, Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ReadinessChecklist } from '@/features/bot/components/readiness-checklist';
export const Route = createFileRoute('/app/bots/$botId/')({
  component: function Overview() {
    const { botId } = Route.useParams();
    const { t } = useTranslation('training');
    const cards = [
      {
        to: '/app/bots/$botId/products',
        key: 'products',
        body: 'productsDescription',
        icon: Boxes,
      },
      {
        to: '/app/bots/$botId/instructions',
        key: 'instructions',
        body: 'scenarioSubtitle',
        icon: Workflow,
      },
      {
        to: '/app/bots/$botId/knowledge',
        key: 'information',
        body: 'informationDescription',
        icon: BookOpen,
      },
      {
        to: '/app/bots/$botId/integrations',
        key: 'integrations',
        body: 'integrationsDescription',
        icon: Plug,
      },
    ] as const;
    return (
      <div className="min-w-0 space-y-6">
        <header>
          <h2 className="text-2xl font-semibold tracking-tight">{t('homeTitle')}</h2>
          <p className="mt-2 text-muted-foreground">{t('homeSubtitle')}</p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map(({ to, key, body, icon: Icon }) => (
            <Link
              key={key}
              to={to}
              params={{ botId }}
              className="rounded-xl border bg-card p-4 transition-colors hover:border-primary hover:bg-primary-soft"
            >
              <Icon className="size-5 text-primary" aria-hidden />
              <h3 className="mt-3 font-medium">{t(key)}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(body)}</p>
            </Link>
          ))}
        </div>
        <ReadinessChecklist botId={botId} />
        <p className="text-sm text-muted-foreground">{t('testHint')}</p>
      </div>
    );
  },
});
