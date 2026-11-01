import { cn } from '@/lib/utils';

/** A neutral wordmark tile: the official KiotViet asset is not bundled. */
export function KiotVietLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      role="img"
      aria-label="KiotViet"
      className={cn('size-11 shrink-0', className)}
    >
      <rect width="48" height="48" rx="12" className="fill-primary/10" />
      <text
        x="24"
        y="27.5"
        textAnchor="middle"
        className="fill-primary font-sans text-[9.5px] font-bold tracking-tight"
      >
        KiotViet
      </text>
    </svg>
  );
}
