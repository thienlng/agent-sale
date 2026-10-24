import type { CrmOptionDto, TagDto } from '@agent-sales/contracts';

import { useAssignees, useCrmOptions, useCrmTags } from '../api/crm';

export interface CrmLookups {
  sources: CrmOptionDto[];
  statuses: CrmOptionDto[];
  tags: TagDto[];
  assignees: Array<{ userId: string; name: string; role: string }>;
  source: (id: string | null) => CrmOptionDto | undefined;
  status: (id: string | null) => CrmOptionDto | undefined;
  tag: (id: string) => TagDto | undefined;
  member: (id: string | null) => string | undefined;
}

/** Sources, statuses, tags and members by id, for rendering ids in lists and the drawer. */
export function useCrmLookups(): CrmLookups {
  const sources = useCrmOptions('sources').data ?? [];
  const statuses = useCrmOptions('statuses').data ?? [];
  const tags = useCrmTags().data ?? [];
  const assignees = useAssignees().data ?? [];
  return {
    sources,
    statuses,
    tags,
    assignees,
    source: (id) => (id ? sources.find((s) => s.id === id) : undefined),
    status: (id) => (id ? statuses.find((s) => s.id === id) : undefined),
    tag: (id) => tags.find((t) => t.id === id),
    member: (id) => (id ? assignees.find((m) => m.userId === id)?.name : undefined),
  };
}
