import { createFileRoute } from '@tanstack/react-router';
import { ChannelPage } from '@/features/channel/components/channel-page';
export const Route = createFileRoute('/app/channels')({ component: ChannelPage });
