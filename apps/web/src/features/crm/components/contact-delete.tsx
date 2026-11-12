import type { ContactDto } from '@agent-sales/contracts';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/permissions';

import { useDeleteContact } from '../api/crm';
import { contactLabel, crmErrorMessage } from '../hooks/crm-errors';

/**
 * Confirmation for deleting a customer on request (docs/09 §10): says what goes for good and what
 * stays anonymized before anything is sent.
 */
export function ContactDeleteDialog({
  contact,
  open,
  onOpenChange,
  onDeleted,
}: {
  contact: Pick<ContactDto, 'id' | 'name' | 'phone' | 'email'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const remove = useDeleteContact();
  return (
    <AlertDialog open={open} onOpenChange={(o) => !remove.isPending && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('crm.delete.title', { name: contactLabel(contact, t) })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('crm.delete.intro')}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <section>
            <h4 className="font-medium">{t('crm.delete.removedTitle')}</h4>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              <li>{t('crm.delete.removedProfile')}</li>
              <li>{t('crm.delete.removedConversations')}</li>
              <li>{t('crm.delete.removedFiles')}</li>
            </ul>
          </section>
          <section>
            <h4 className="font-medium">{t('crm.delete.keptTitle')}</h4>
            <p className="mt-1 text-muted-foreground">{t('crm.delete.kept')}</p>
          </section>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>
            {t('crm.delete.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={(e) => {
              // Keep the dialog open until the server answers.
              e.preventDefault();
              remove.mutate(contact.id, {
                onSuccess: (r) => {
                  toast.success(t('crm.delete.done', r));
                  onOpenChange(false);
                  onDeleted();
                },
                onError: (err) => toast.error(crmErrorMessage(t, err)),
              });
            }}
          >
            {remove.isPending ? t('crm.delete.deleting') : t('crm.delete.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The "delete customer" block at the end of the customer drawer; owners and admins only. */
export function ContactDangerZone({
  contact,
  onDeleted,
}: {
  contact: Pick<ContactDto, 'id' | 'name' | 'phone' | 'email'>;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!useCan('contacts.delete')) return null;
  return (
    <section className="mt-6 flex flex-col gap-2 rounded-lg border border-destructive/40 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="text-sm font-medium">{t('crm.delete.zoneTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('crm.delete.zoneHint')}</p>
      </div>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Trash2 />
        {t('crm.delete.action')}
      </Button>
      <ContactDeleteDialog
        contact={contact}
        open={open}
        onOpenChange={setOpen}
        onDeleted={onDeleted}
      />
    </section>
  );
}
