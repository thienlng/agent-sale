import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCan } from '@/lib/permissions';

import { SaasRequestForm } from './saas-request-form';
import { SubscriptionCard } from './subscription-card';

/** Inbox block body for a SaaS business: the linked customer's plan and a prefilled request. */
export function SaasInboxPanel({
  name,
  phone,
  contactId,
}: {
  name: string;
  phone: string;
  contactId: string | null;
}) {
  const { t } = useTranslation(),
    canCreate = useCan('contacts.edit');
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      {contactId && <SubscriptionCard contactId={contactId} />}
      <Button asChild variant="outline" size="sm" className="w-full">
        <Link to="/app/saas-requests">{t('saas.requestsTitle')}</Link>
      </Button>
      {canCreate && (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
          <Plus />
          {t('saas.newRequest')}
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('saas.newRequest')}</DialogTitle>
            <DialogDescription>{t('saas.requestsIntro')}</DialogDescription>
          </DialogHeader>
          {open && (
            <SaasRequestForm
              initialName={name}
              initialPhone={phone}
              contactId={contactId}
              onSaved={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
