import type { ConversationDto, MetaProvider } from '@agent-sales/contracts';
import type { SVGProps } from 'react';
import { cn } from '@/lib/utils';

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
  provider: MetaProvider;
  className?: string;
}) {
  const Mark = provider === 'facebook' ? MessengerMark : InstagramMark;
  return <Mark className={cn('size-4', className)} />;
}

/** Customer initial with the channel badge at the bottom-left, as in the reference inbox. */
export function CustomerAvatar({ conversation: c }: { conversation: ConversationDto }) {
  return (
    <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-semibold text-primary">
      {(c.customerName.trim().charAt(0) || '?').toUpperCase()}
      <span className="absolute -bottom-0.5 -left-0.5 grid size-4.5 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground">
        <ProviderMark provider={c.provider} className="size-2.5" />
      </span>
    </span>
  );
}
