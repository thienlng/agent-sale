import type { ChannelConnectionDto } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { MessagesSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export const commentsT = 'channelInbox.commentsWorkspace';

export interface PostLabel {
  postId: string;
  label: string;
}

export function ChannelsLink({ label }: { label: string }) {
  return (
    <Button asChild variant="outline" className="mt-4">
      <Link to="/app/channels">{label}</Link>
    </Button>
  );
}

export function State({
  title,
  body,
  alert,
  busy,
  children,
}: {
  title: string;
  body?: string;
  alert?: boolean;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center p-8 text-center"
      role={alert ? 'alert' : busy ? 'status' : undefined}
    >
      <MessagesSquare className="mb-3 size-9 text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      {body ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p> : null}
      {children}
    </div>
  );
}

export type FacebookPage = Pick<ChannelConnectionDto, 'id' | 'name' | 'status' | 'expiresAt'>;
export function pageUsable(page: FacebookPage, now: number) {
  return page.status === 'connected' && !(page.expiresAt && Date.parse(page.expiresAt) <= now);
}
