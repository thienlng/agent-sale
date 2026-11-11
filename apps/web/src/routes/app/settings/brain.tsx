import { createFileRoute } from '@tanstack/react-router';

import { BrainSettingsCard } from '@/features/brain/components/brain-settings-card';
import { CareSettingsCard } from '@/features/brain/components/care-settings-card';
import { loadNamespace } from '@/lib/i18n';

/**
 * Settings → AI & follow-up: the Business Brain card (usage, mode, quiet time, briefing) and the
 * care agent card ("Chăm sóc tự động": templates, autonomy level, quiet hours, daily cap).
 */
export const Route = createFileRoute('/app/settings/brain')({
  loader: () => loadNamespace('brain').then(() => undefined),
  component: function BrainSettingsPage() {
    return (
      <div className="flex flex-col gap-5">
        <BrainSettingsCard />
        <CareSettingsCard />
      </div>
    );
  },
});
