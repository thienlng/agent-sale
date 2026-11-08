import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

/*
 * Brand Precision v2, Compact density (dashboards): controls are 44px high and every size keeps a
 * 44px hit target — the small sizes extend it with an invisible ::after so dense toolbars stay
 * tidy. Flat by default; text on orange is always Charcoal (primary-foreground).
 */
const HIT_AREA =
  "after:absolute after:left-1/2 after:top-1/2 after:size-full after:min-h-11 after:min-w-11 after:-translate-1/2 after:content-['']";

const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-3 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary-strong active:bg-primary-strong',
        outline:
          'border-input bg-background text-foreground hover:bg-muted aria-expanded:bg-muted dark:bg-transparent',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-secondary',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground',
        destructive:
          'bg-destructive-soft text-destructive hover:bg-[color-mix(in_oklch,var(--destructive-soft),var(--destructive)_12%)] focus-visible:ring-destructive',
        link: 'text-brand-text underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-11 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        xs: `h-7 gap-1 rounded-md px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5 ${HIT_AREA}`,
        sm: `h-9 gap-1.5 px-3 text-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 ${HIT_AREA}`,
        lg: 'h-12 gap-2 px-6 text-base has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5',
        icon: 'size-11',
        'icon-xs': `size-7 rounded-md [&_svg:not([class*='size-'])]:size-3.5 ${HIT_AREA}`,
        'icon-sm': `size-9 ${HIT_AREA}`,
        'icon-lg': 'size-12',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
