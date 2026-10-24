import { createFileRoute } from '@tanstack/react-router';

import { ProfilePage } from '@/features/workspace/components/profile-page';

export const Route = createFileRoute('/app/settings/profile')({
  component: ProfilePage,
});
