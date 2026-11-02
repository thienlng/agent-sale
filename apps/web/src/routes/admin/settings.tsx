import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/features/admin/components/backoffice/settings-page';

export const Route = createFileRoute('/admin/settings')({
  component: SettingsPage,
});
