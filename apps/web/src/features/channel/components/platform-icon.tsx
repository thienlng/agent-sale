import { Clock, Globe, Network } from 'lucide-react';
import type { ReactNode, SVGProps } from 'react';
import { cn } from '@/lib/utils';
import type { PlatformKey } from '../lib/integrations';

type IconProps = SVGProps<SVGSVGElement>;

/** Simplified brand marks (lucide ships no brand icons); colour comes from `currentColor`. */
export function FacebookMark(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 2a10 10 0 0 0-1.56 19.88v-7H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v7A10 10 0 0 0 12 2Z" />
    </svg>
  );
}

export function InstagramMark(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
      {...props}
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ZaloMark(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        fill="currentColor"
        fontFamily="inherit"
      >
        Zalo
      </text>
    </svg>
  );
}

function TikTokMark(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M16.6 2h-3.3v13.2a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9a6.2 6.2 0 1 0 5.3 6.2V8.4a7.6 7.6 0 0 0 4.4 1.4V6.5a4.4 4.4 0 0 1-4.4-4.5Z" />
    </svg>
  );
}

function LazadaMark(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...props}>
      <path d="M12 21s-8-4.9-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6.1-8 11-8 11Z" />
    </svg>
  );
}

const MARKS: Record<PlatformKey, (props: IconProps) => ReactNode> = {
  all: (props) => <Network {...props} />,
  pending: (props) => <Clock {...props} />,
  facebook: FacebookMark,
  instagram: InstagramMark,
  zalo: ZaloMark,
  lazada: LazadaMark,
  tiktok: TikTokMark,
  website: (props) => <Globe {...props} />,
};

const TILE: Record<PlatformKey, string> = {
  all: 'bg-primary text-primary-foreground',
  pending: 'bg-warning-soft text-warning',
  facebook: 'bg-primary-soft text-primary',
  instagram: 'bg-destructive-soft text-destructive',
  zalo: 'bg-primary-soft text-primary',
  lazada: 'bg-muted text-muted-foreground',
  tiktok: 'bg-foreground text-background',
  website: 'bg-muted text-muted-foreground',
};

/** Square platform tile used in the platform list. */
export function PlatformTile({
  platform,
  className,
}: {
  platform: PlatformKey;
  className?: string;
}) {
  const Mark = MARKS[platform];
  return (
    <span
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-xl',
        TILE[platform],
        className,
      )}
    >
      <Mark className="size-5" />
    </span>
  );
}

/** Small inline provider glyph (cards, conversation badges). */
export function ProviderGlyph({
  provider,
  className,
}: {
  provider: 'facebook' | 'instagram';
  className?: string;
}) {
  const Mark = provider === 'facebook' ? FacebookMark : InstagramMark;
  return <Mark className={cn('size-4 text-primary', className)} />;
}
