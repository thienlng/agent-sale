import { createFileRoute } from '@tanstack/react-router';

import { MembersPage } from '@/features/team/components/members-page';

export const Route = createFileRoute('/app/members')({
  component: MembersPage,
});
