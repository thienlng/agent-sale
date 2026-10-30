import { ContactFilter, type SaasStage } from '@agent-sales/contracts';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { ContactsList } from '@/features/crm/components/contacts-list';
import { ContactConversations } from './-components/contact-conversations';
import { SORT_KEYS } from '@/features/crm/components/contacts-search';
import { useCrmLookups } from '@/features/crm/hooks/use-crm-lookups';
import { SaasSummaryStrip } from '@/features/saas/components/saas-summary-strip';
import { SubscriptionCard } from '@/features/saas/components/subscription-card';
import {
  STAGE_STATUS_KEY,
  useSubscriptionColumns,
} from '@/features/saas/components/subscription-columns';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { useCan } from '@/lib/permissions';

/** List state lives in the URL; anything malformed falls back to "none". */
const Search = z.object({
  q: z.string().max(100).optional().catch(undefined),
  filter: ContactFilter.optional().catch(undefined),
  view: z.uuid().optional().catch(undefined),
  sort: z.enum(SORT_KEYS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  pageSize: z.coerce
    .number()
    .int()
    .pipe(z.union([z.literal(20), z.literal(50), z.literal(100)]))
    .optional()
    .catch(undefined),
  contact: z.uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/app/contacts')({
  validateSearch: Search,
  component: function ContactsPage() {
    const search = Route.useSearch();
    const navigate = useNavigate({ from: '/app/contacts' });
    const saas = useCurrentWorkspace().data?.industry === 'saas';
    // A SaaS business keeps its subscribers on the same list (ADR-014): figures on top,
    // plan columns per row, the plan card in the customer sheet.
    const canViewAll = useCan('contacts.view_all');
    const revenue = saas && canViewAll;
    const [rowIds, setRowIds] = useState<string[]>([]);
    const subscriptionColumns = useSubscriptionColumns(rowIds, revenue);
    const { statuses } = useCrmLookups();
    const showStage = (stage: SaasStage) => {
      const status = statuses.find((o) => o.key === STAGE_STATUS_KEY[stage]);
      if (!status) return;
      void navigate({
        search: {
          filter: {
            v: 1,
            match: 'all',
            rules: [{ field: 'statusId', op: 'in', value: [status.id] }],
            duplicatesOnly: false,
          },
        },
      });
    };
    return (
      <ContactsList
        search={search}
        onSearch={(next) => void navigate({ search: next, replace: true })}
        renderConversations={(contactId) => <ContactConversations contactId={contactId} />}
        renderOverviewExtra={
          saas ? (contactId) => <SubscriptionCard contactId={contactId} /> : undefined
        }
        summary={
          saas ? (
            <SaasSummaryStrip
              onStage={showStage}
              onOpenContact={(contact) => void navigate({ search: { ...search, contact } })}
            />
          ) : undefined
        }
        extraColumns={subscriptionColumns}
        onRowsChange={revenue ? setRowIds : undefined}
      />
    );
  },
});
