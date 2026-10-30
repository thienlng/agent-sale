import { ContactFilter } from '@agent-sales/contracts';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { ContactsList } from '@/features/crm/components/contacts-list';
import { ContactConversations } from './-components/contact-conversations';
import { SORT_KEYS } from '@/features/crm/components/contacts-search';

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
    return (
      <ContactsList
        search={search}
        onSearch={(next) => void navigate({ search: next, replace: true })}
        renderConversations={(contactId) => <ContactConversations contactId={contactId} />}
      />
    );
  },
});
