import type { ReactNode } from 'react';

/**
 * A view's title, one-line hint and main action (schedules, skills, memory, settings). Compact in
 * the side sheet; on the full page (`data-assistant-page`) the title grows to a page heading.
 */
export function ViewHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold text-balance in-data-assistant-page:text-xl in-data-assistant-page:tracking-tight">
          {title}
        </h2>
        {hint ? <p className="mt-1 text-sm text-pretty text-muted-foreground">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
