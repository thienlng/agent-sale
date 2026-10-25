import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A tag in its library colour: a tinted pill with a colour dot, readable on any colour. */
export function TagChip({
  name,
  color,
  className,
  children,
}: {
  name: string;
  color: string;
  className?: string;
  children?: ReactNode;
}) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(color);
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-px text-[10px] leading-4 font-medium text-foreground',
        className,
      )}
      style={valid ? { backgroundColor: `${color}22`, borderColor: `${color}66` } : undefined}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full bg-primary"
        style={valid ? { backgroundColor: color } : undefined}
      />
      <span className="truncate">{name}</span>
      {children}
    </span>
  );
}
