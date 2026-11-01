import { createFileRoute } from '@tanstack/react-router';

import { KiotVietPage } from '@/features/integration/components/kiotviet-page';
import { loadNamespace } from '@/lib/i18n';

export const Route = createFileRoute('/app/integrations/kiotviet')({
  loader: () => loadNamespace('integration'),
  component: KiotVietPage,
});
