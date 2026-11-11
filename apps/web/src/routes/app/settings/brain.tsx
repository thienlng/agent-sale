import { createFileRoute } from '@tanstack/react-router';

import { BrainSettingsCard } from '@/features/brain/components/brain-settings-card';
import { loadNamespace } from '@/lib/i18n';

/** Settings → AI evaluation: the Business Brain card (usage, mode, quiet time, briefing). */
export const Route = createFileRoute('/app/settings/brain')({
  loader: () => loadNamespace('brain').then(() => undefined),
  component: BrainSettingsCard,
});
