import { ContactFilter, type SaasStage } from '@agent-sales/contracts';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { ContactsList } from '@/features/crm/components/contacts-list';
import { ContactConversations } from './-components/contact-conversations';
import { CustomerRequestsCard } from '@/features/crm/components/customer-requests-card';
import { SORT_KEYS, statusFilter } from '@/features/crm/components/contacts-search';
import { RequestSummaryStrip } from '@/features/crm/components/request-summary-strip';
import { useCrmLookups } from '@/features/crm/hooks/use-crm-lookups';
import { SaasSummaryStrip } from '@/features/saas/components/saas-summary-strip';
import { SubscriptionCard } from '@/features/saas/components/subscription-card';
import {
  STAGE_STATUS_KEY,
  useSubscriptionColumns,
} from '@/features/saas/components/subscription-columns';
import { useCurrentWorkspace } from '@/features/workspace/api/use-current-workspace';
import { industryGroup } from '@/lib/industry-group';
import { useCan } from '@/lib/permissions';
import { loadNamespace } from '@/lib/i18n';

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
  // The KiotViet badge and field hint read the `integration` namespace (kept out of common.json).
  // A failed load shows raw keys there instead of the error page.
  loader: () => loadNamespace('integration').catch(() => undefined),
  component: function ContactsPage() {
    const search = Route.useSearch();
    const navigate = useNavigate({ from: '/app/contacts' });
    const industry = useCurrentWorkspace().data?.industry;
    const saas = industry === 'saas';
    // Education and spa: the bot's requests on top, the customer's requests in the sheet.
    const service = industryGroup(industry) === 'service' ? industry : undefined;
    // A SaaS business keeps its subscribers on the same list (ADR-020): figures on top,
    // plan columns per row, the plan card in the customer sheet.
    const canViewAll = useCan('contacts.view_all');
    const revenue = saas && canViewAll;
    const [rowIds, setRowIds] = useState<string[]>([]);
    const subscriptionColumns = useSubscriptionColumns(rowIds, revenue);
    const { statuses } = useCrmLookups();
    const showStatus = (statusId: string) =>
      void navigate({ search: { filter: statusFilter([statusId]) } });
    const showStage = (stage: SaasStage) => {
      const status = statuses.find((o) => o.key === STAGE_STATUS_KEY[stage]);
      if (status) showStatus(status.id);
    };
    const openContact = (contact: string) => void navigate({ search: { ...search, contact } });
    return (
      <ContactsList
        search={search}
        onSearch={(next) => void navigate({ search: next, replace: true })}
        renderConversations={(contactId) => <ContactConversations contactId={contactId} />}
        renderOverviewExtra={
          saas
            ? (contactId) => <SubscriptionCard contactId={contactId} />
            : service
              ? (contactId) => <CustomerRequestsCard contactId={contactId} industry={service} />
              : undefined
        }
        summary={
          saas ? (
            <SaasSummaryStrip onStage={showStage} onOpenContact={openContact} />
          ) : service ? (
            <RequestSummaryStrip
              industry={service}
              onStatus={showStatus}
              onOpenContact={openContact}
            />
          ) : undefined
        }
        industry={industry}
        extraColumns={subscriptionColumns}
        onRowsChange={revenue ? setRowIds : undefined}
      />
    );
  },
});
