import { createFileRoute } from '@tanstack/react-router';

import { useEntitlements } from '@/features/billing/api/use-entitlements';
import { DevelopersPage } from '@/features/developer/components/developers-page';
import { loadNamespace } from '@/lib/i18n';
import { useCan } from '@/lib/permissions';

export const Route = createFileRoute('/app/settings/developers')({
  loader: () => loadNamespace('developer'),
  component: function DevelopersRoute() {
    const canManage = useCan('developer.manage');
    const entitlements = useEntitlements({ enabled: canManage });
    return <DevelopersPage apiEnabled={entitlements.data?.features['feature.public_api']} />;
  },
});
