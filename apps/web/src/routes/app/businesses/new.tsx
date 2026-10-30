import { createFileRoute } from '@tanstack/react-router';

import { CreateBusinessPage } from '@/features/workspace/components/create-business-page';

export const Route = createFileRoute('/app/businesses/new')({
  component: CreateBusinessPage,
});
