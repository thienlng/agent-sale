import type { CrmOptionDto, TagAssignmentDto } from '@agent-sales/contracts';

import { cn } from '@/lib/utils';

import type { CrmLookups } from '../hooks/use-crm-lookups';

/** A source or status as a colored dot + name; archived ones are muted. */
export function OptionBadge({ option }: { option: CrmOptionDto | undefined }) {
  if (!option) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn('inline-flex items-center gap-1.5', option.archived && 'opacity-60')}>
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: option.color }}
        aria-hidden
      />
      <span className="truncate">{option.name}</span>
    </span>
  );
}

/** A tag chip in the tag's color (tinted background, readable text). */
export function TagChip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex max-w-40 items-center rounded-full border px-2 py-0.5 text-xs font-medium"
      style={{ borderColor: `${color}66`, backgroundColor: `${color}1a` }}
    >
      <span
        className="mr-1 size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function TagChips({
  assignments,
  lookups,
  max,
}: {
  assignments: TagAssignmentDto[];
  lookups: CrmLookups;
  max?: number;
}) {
  if (!assignments.length) return <span className="text-muted-foreground">—</span>;
  const shown = max ? assignments.slice(0, max) : assignments;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((a) => {
        const tag = lookups.tag(a.tagId);
        return tag ? <TagChip key={a.id} name={tag.name} color={tag.color} /> : null;
      })}
      {max && assignments.length > max ? (
        <span className="text-xs text-muted-foreground">+{assignments.length - max}</span>
      ) : null}
    </span>
  );
}
