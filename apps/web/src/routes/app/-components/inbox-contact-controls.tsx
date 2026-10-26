import type { ContactDto } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateContact } from '@/features/crm/api/crm';
import { ContactTags } from '@/features/crm/components/contact-tags';
import { crmErrorMessage } from '@/features/crm/hooks/crm-errors';
import type { CrmLookups } from '@/features/crm/hooks/use-crm-lookups';
import { useCan } from '@/lib/permissions';

/** Existing CRM controls composed here keep tag permissions and optimistic version checks. */
export function InboxContactControls({
  contact,
  lookups,
}: {
  contact: ContactDto;
  lookups: CrmLookups;
}) {
  const { t } = useTranslation();
  const update = useUpdateContact(contact.id);
  const readOnly = !useCan('contacts.edit');
  return (
    <div className="space-y-3">
      <Label htmlFor={`inbox-contact-status-${contact.id}`}>
        {t('channelInbox.sales.customerStage')}
      </Label>
      <Select
        value={contact.statusId ?? '__none'}
        disabled={readOnly || update.isPending}
        onValueChange={(value) => {
          const statusId = value === '__none' ? null : value;
          update.mutate(
            { statusId, expectedVersion: contact.version },
            {
              onSuccess: () =>
                toast.success(
                  t('crm.detail.statusChanged', {
                    status: lookups.status(statusId)?.name ?? t('crm.field.none'),
                  }),
                ),
              onError: (error) => toast.error(crmErrorMessage(t, error)),
            },
          );
        }}
      >
        <SelectTrigger id={`inbox-contact-status-${contact.id}`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">{t('crm.field.none')}</SelectItem>
          {lookups.statuses
            .filter((status) => !status.archived || status.id === contact.statusId)
            .map((status) => (
              <SelectItem key={status.id} value={status.id}>
                {status.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <ContactTags contact={contact} lookups={lookups} readOnly={readOnly} />
    </div>
  );
}
