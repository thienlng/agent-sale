import { createFileRoute } from '@tanstack/react-router';
import { InboxPage } from '@/features/conversation/components/inbox-page';
export const Route = createFileRoute('/app/inbox')({ component: InboxPage });
