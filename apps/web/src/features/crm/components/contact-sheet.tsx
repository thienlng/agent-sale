import { FolderLock } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDateTime } from '@/lib/format';

import { useContact } from '../api/crm';
import { contactLabel } from '../hooks/crm-errors';
import type { CrmLookups } from '../hooks/use-crm-lookups';
import { OptionBadge, TagChips } from './crm-badges';
import { ContactDetailsTab } from './contact-details';
import { ContactHistoryTab } from './contact-history';
import { ContactOverviewTab } from './contact-overview';

/** Customer detail drawer: Overview / Details / History / Files (CRM-01). */
export function ContactSheet({
  contactId,
  onClose,
  lookups,
  renderConversations,
  renderOverviewExtra,
}: {
  contactId: string | undefined;
  onClose: () => void;
  lookups: CrmLookups;
  /** The customer's inbox conversations, composed by the route (the inbox is another feature). */
  renderConversations?: ((contactId: string) => ReactNode) | undefined;
  /** Industry blocks under the overview (e.g. a SaaS customer's plan), composed by the route. */
  renderOverviewExtra?: ((contactId: string) => ReactNode) | undefined;
}) {
  const { t } = useTranslation();
  const contact = useContact(contactId);
  const c = contact.data;

  return (
    <Sheet open={Boolean(contactId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="pr-8 text-xl">{c ? contactLabel(c, t) : '…'}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {c ? (
                <>
                  {c.phone ? <span className="tabular-nums">{c.phone}</span> : null}
                  <OptionBadge option={lookups.status(c.statusId)} />
                  <span className="text-muted-foreground">
                    {t('crm.detail.createdBy', { at: formatDateTime(c.createdAt) })}
                  </span>
                  <TagChips assignments={c.tags} lookups={lookups} />
                </>
              ) : null}
            </div>
          </SheetDescription>
        </SheetHeader>
        {!c || !contactId ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-8" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <Tabs defaultValue="overview" className="p-4">
            <TabsList className="w-full">
              {(renderConversations
                ? (['overview', 'details', 'conversations', 'history', 'files'] as const)
                : (['overview', 'details', 'history', 'files'] as const)
              ).map((tab) => (
                <TabsTrigger key={tab} value={tab}>
                  {t(`crm.detail.tabs.${tab}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="overview" className="pt-3">
              <ContactOverviewTab contact={c} lookups={lookups} />
              {renderOverviewExtra ? <div className="mt-4">{renderOverviewExtra(c.id)}</div> : null}
            </TabsContent>
            <TabsContent value="details" className="pt-3">
              <ContactDetailsTab key={`${c.id}:${c.version}`} contact={c} lookups={lookups} />
            </TabsContent>
            {renderConversations ? (
              <TabsContent value="conversations" className="pt-3">
                {renderConversations(c.id)}
              </TabsContent>
            ) : null}
            <TabsContent value="history" className="pt-3">
              <ContactHistoryTab contactId={c.id} lookups={lookups} />
            </TabsContent>
            <TabsContent value="files" className="pt-3">
              <p className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                <FolderLock className="size-5 text-primary" aria-hidden />
                {t('crm.detail.filesSoon')}
              </p>
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
