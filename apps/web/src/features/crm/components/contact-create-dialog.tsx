import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiClientError } from '@/lib/api-client';

import { useCreateContact } from '../api/crm';
import { crmErrorMessage } from '../hooks/crm-errors';
import type { CrmLookups } from '../hooks/use-crm-lookups';
import { changedFields, ContactFields, type ContactDraft, EMPTY_DRAFT } from './contact-form';

/** Add a customer: at least a name, a phone number or an email (CRM-02). */
export function ContactCreateDialog({
  open,
  onOpenChange,
  lookups,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lookups: CrmLookups;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation();
  const create = useCreateContact();
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_DRAFT);
  // One id per form: a double submit or a retry returns the first customer.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  // Set synchronously so a double click cannot submit twice before React re-renders.
  const pendingRef = useRef(false);
  const identified = Boolean(draft.name.trim() || draft.phone.trim() || draft.email.trim());

  const reset = () => {
    setDraft(EMPTY_DRAFT);
    setInvalid(new Set());
    setRequestId(crypto.randomUUID());
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!identified || pendingRef.current) return;
    pendingRef.current = true;
    const fields = Object.fromEntries(
      Object.entries(changedFields(draft, EMPTY_DRAFT)).filter(([, v]) => v !== null && v !== ''),
    );
    create.mutate(
      { ...fields, clientRequestId: requestId },
      {
        onSettled: () => {
          pendingRef.current = false;
        },
        onSuccess: (c) => {
          toast.success(t('crm.create.created'));
          reset();
          onOpenChange(false);
          onCreated(c.id);
        },
        onError: (err) => {
          const f = err instanceof ApiClientError ? err.details?.['fields'] : undefined;
          setInvalid(new Set(f && typeof f === 'object' ? Object.keys(f) : []));
          toast.error(crmErrorMessage(t, err));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('crm.create.title')}</DialogTitle>
            <DialogDescription>{t('crm.create.hint')}</DialogDescription>
          </DialogHeader>
          <ContactFields
            idPrefix="cc"
            value={draft}
            onChange={setDraft}
            lookups={lookups}
            invalid={invalid}
          />
          <DialogFooter>
            <Button type="submit" disabled={!identified || create.isPending}>
              {t('crm.create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
