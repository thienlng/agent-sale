import type { ContactDto } from '@agent-sales/contracts';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';

import { useUpdateContact } from '../api/crm';
import { crmErrorMessage } from '../hooks/crm-errors';
import type { CrmLookups } from '../hooks/use-crm-lookups';
import { changedFields, ContactFields, type ContactDraft, draftOf } from './contact-form';
import { ContactTags } from './contact-tags';

/**
 * Profile, source/status, ownership and tags. Saves only what changed, with the
 * version it was loaded at: a stale save shows a message and reloads the latest.
 */
export function ContactDetailsTab({
  contact,
  lookups,
}: {
  contact: ContactDto;
  lookups: CrmLookups;
}) {
  const { t } = useTranslation();
  const update = useUpdateContact(contact.id);
  const readOnly = !useCan('contacts.edit');
  const base = useMemo(() => draftOf(contact), [contact]);
  const [draft, setDraft] = useState<ContactDraft>(base);
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const changes = changedFields(draft, base);
  const dirty = Object.keys(changes).length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    update.mutate(
      { ...changes, expectedVersion: contact.version },
      {
        onSuccess: () => toast.success(t('crm.detail.saved')),
        onError: (err) => {
          const f = err instanceof ApiClientError ? err.details?.['fields'] : undefined;
          setInvalid(new Set(f && typeof f === 'object' ? Object.keys(f) : []));
          toast.error(crmErrorMessage(t, err));
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset disabled={readOnly} className="contents">
          <ContactFields
            idPrefix="cd"
            value={draft}
            onChange={setDraft}
            lookups={lookups}
            invalid={invalid}
          />
        </fieldset>
        <div className={readOnly ? 'hidden' : 'flex justify-end gap-2'}>
          <Button type="button" variant="ghost" disabled={!dirty} onClick={() => setDraft(base)}>
            {t('crm.detail.cancel')}
          </Button>
          <Button type="submit" disabled={!dirty || update.isPending}>
            {t('crm.detail.save')}
          </Button>
        </div>
      </form>
      <ContactTags contact={contact} lookups={lookups} readOnly={readOnly} />
    </div>
  );
}
