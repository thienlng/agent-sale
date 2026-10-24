import { createFileRoute } from '@tanstack/react-router';

import { TagsManager } from '@/features/crm/components/tags-manager';

export const Route = createFileRoute('/app/crm-settings/tags')({
  component: TagsManager,
});
