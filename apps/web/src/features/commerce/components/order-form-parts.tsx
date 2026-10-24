import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** A titled block of the order form. */
export function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border bg-card p-4 md:p-5', className)}>
      <h2 className="mb-4 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Field({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  /** Shows a required marker (the input carries `required` itself). */
  required?: boolean;
  /** Shown under the input; the input should point at it with aria-describedby. */
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** `datetime-local` value for now, in the browser's time zone. */
export function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
