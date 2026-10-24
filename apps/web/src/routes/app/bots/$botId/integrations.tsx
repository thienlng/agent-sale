import { createFileRoute, Link } from '@tanstack/react-router';
import { Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
export const Route = createFileRoute('/app/bots/$botId/integrations')({
  component: function IntegrationsPage() {
    const { t } = useTranslation('training');
    return (
      <section className="space-y-4">
        <Plug className="size-9 text-primary" aria-hidden />
        <h2 className="text-xl font-semibold">{t('integrations')}</h2>
        <p className="text-muted-foreground">{t('integrationsDescription')}</p>
        <Button asChild>
          <Link to="/app/channels">{t('openIntegrations')}</Link>
        </Button>
      </section>
    );
  },
});
