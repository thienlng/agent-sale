import type { ChannelProvider } from '@agent-sales/contracts';
import { Globe } from 'lucide-react';
import { type ReactNode, type SVGProps, useState } from 'react';
import { cn } from '@/lib/utils';
import { customerInitial } from '../lib/inbox-list';
import type { InboxConversation } from '../lib/inbox-v2-types';

type IconProps = SVGProps<SVGSVGElement>;

/** Simplified Messenger / Instagram marks (lucide ships no brand icons). */
function MessengerMark(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 2C6.4 2 2 6.1 2 11.6c0 2.9 1.2 5.4 3.1 7.1v3.3l3-1.7c1.2.3 2.5.5 3.9.5 5.6 0 10-4.1 10-9.6S17.6 2 12 2Zm1 12.9-2.6-2.7-4.9 2.7 5.4-5.7 2.6 2.7 4.8-2.7-5.3 5.7Z" />
    </svg>
  );
}
function InstagramMark(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden
      {...props}
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

export function ProviderMark({
  provider,
  className,
}: {
  provider: ChannelProvider;
  className?: string;
}) {
  const Mark =
    provider === 'facebook' ? MessengerMark : provider === 'website' ? Globe : InstagramMark;
  return <Mark className={cn('size-4', className)} />;
}

/** Brand colour and short label per channel, so a rep tells Messenger from Instagram at a glance. */
const CHANNEL_STYLE: Record<ChannelProvider, { label: string; className: string }> = {
  facebook: { label: 'Messenger', className: 'bg-[#0866ff] text-white' },
  website: { label: 'Website', className: 'bg-primary text-primary-foreground' },
  instagram: {
    label: 'Instagram',
    className: 'bg-gradient-to-tr from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white',
  },
};

/** Small coloured pill naming the channel; the page name is in the tooltip. */
export function ChannelBadge({
  provider,
  title,
}: {
  provider: ChannelProvider;
  title?: string | undefined;
}) {
  const style = CHANNEL_STYLE[provider];
  return (
    <span
      title={title ? `${style.label} · ${title}` : style.label}
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-[10px] leading-3.5 font-semibold',
        style.className,
      )}
    >
      <ProviderMark provider={provider} className="size-2.5" />
      {style.label}
    </span>
  );
}

const SIZES = { md: 'size-10 text-sm', sm: 'size-8 text-xs' } as const;

/** Meta profile photo, or the customer's initial, with the channel badge at the bottom-left. */
export function CustomerAvatar({
  conversation: c,
  name,
  size = 'md',
  children,
}: {
  conversation: Pick<InboxConversation, 'customerName' | 'provider' | 'customerAvatarUrl'>;
  /** Display name for the initial; defaults to the stored customer name. */
  name?: string;
  size?: keyof typeof SIZES;
  /** Extra badges (e.g. the unread count) positioned by the caller. */
  children?: ReactNode;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = c.customerAvatarUrl && c.customerAvatarUrl !== failedUrl ? c.customerAvatarUrl : null;
  return (
    <span
      className={cn(
        'relative grid shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary',
        SIZES[size],
      )}
    >
      {url ? (
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          className="size-full rounded-full object-cover"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        customerInitial(name ?? c.customerName)
      )}
      <span
        className={cn(
          'absolute -bottom-0.5 -left-0.5 grid size-4 place-items-center rounded-full border-2 border-background',
          CHANNEL_STYLE[c.provider].className,
        )}
      >
        <ProviderMark provider={c.provider} className="size-2.5" />
      </span>
      {children}
    </span>
  );
}
