import type { ContactDto, ConversationDto, OrderDto } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { Check, Copy, Maximize2, Package, Search, ShoppingBag, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { InboxOrderContext } from '@/features/commerce/hooks/inbox-order-draft';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrderForm } from '@/features/commerce/components/order-form';
import { OrderStatusBadge } from '@/features/commerce/components/order-status-badge';
import { useInboxActions } from '@/features/conversation/api/inbox';
import { CustomerPanel } from '@/features/conversation/components/customer-panel';
import { useContact, useContacts } from '@/features/crm/api/crm';
import { ContactSheet } from '@/features/crm/components/contact-sheet';
import { useCrmLookups } from '@/features/crm/hooks/use-crm-lookups';
import { formatVnd } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { useSession } from '@/lib/session';
import { InboxContactControls } from './inbox-contact-controls';

export interface InboxCustomerContext {
  contact?: ContactDto | undefined;
  orders: OrderDto[];
  created?: OrderDto | undefined;
}

/** Compose separate domain features at the route boundary, with explicit CRM selection. */
export function InboxSalesPanel({
  conversation: c,
  value,
  onChange,
  onOrderCreated,
}: {
  conversation: ConversationDto;
  value: InboxCustomerContext;
  onChange: (value: InboxCustomerContext) => void;
  onOrderCreated: (order: OrderDto) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.sales.${key}`);
  const [tab, setTab] = useState('customer');
  const [profile, setProfile] = useState<string>();
  const [generation, setGeneration] = useState(0);
  const created = value.created;
  const lookups = useCrmLookups();
  const { update } = useInboxActions(c.id);
  const session = useSession();
  const mine = c.assigneeId === session?.user.id;
  const canCreate = useCan('orders.manage');
  const owner = lookups.member(c.assigneeId) ?? (mine ? session?.user.name : undefined);
  const selectedContact = useContact(value.contact?.id);
  const contact = selectedContact.data;
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(tr('copied'));
    } catch {
      toast.error(tr('copyError'));
    }
  }
  return (
    <Tabs value={tab} onValueChange={setTab} className="min-w-0 gap-0">
      <div className="sticky top-0 z-10 border-b bg-background p-3">
        <TabsList className="w-full">
          <TabsTrigger value="customer" className="flex-1">
            <UserRound className="size-4" />
            {tr('customerTab')}
          </TabsTrigger>
          <TabsTrigger value="order" className="flex-1">
            <ShoppingBag className="size-4" />
            {tr('orderTab')}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="customer" className="mt-0">
        <div className="space-y-4 border-b p-4">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{tr('owner')}</span>
            <span className="truncate font-medium">
              {owner ?? t(`channelInbox.${c.assigneeId ? 'assigned' : 'unassigned'}`)}
            </span>
          </div>
          {value.contact && !contact ? (
            <div role="status" className="space-y-2 rounded-xl border p-3 text-sm">
              <p>
                {t(selectedContact.isError ? 'channelInbox.loadError' : 'channelInbox.loading')}
              </p>
              <Button variant="outline" size="sm" onClick={() => void selectedContact.refetch()}>
                {t('channelInbox.retry')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange({ ...value, contact: undefined })}
              >
                {tr('changeContact')}
              </Button>
            </div>
          ) : contact ? (
            <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{tr('selectedContact')}</p>
                  <p className="break-words font-semibold">
                    {contact.name ?? contact.phone ?? contact.email}
                  </p>
                </div>
                <Check className="size-4 shrink-0 text-success" />
              </div>
              {contact.phone ? (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <a href={`tel:${contact.phone}`} className="hover:underline">
                    {contact.phone}
                  </a>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={tr('copyPhone')}
                    onClick={() => void copy(contact.phone ?? '')}
                  >
                    <Copy />
                  </Button>
                </div>
              ) : null}
              {contact.address ? (
                <p className="break-words text-sm text-muted-foreground">
                  {[contact.address, contact.ward, contact.province].filter(Boolean).join(', ')}
                </p>
              ) : null}
              <InboxContactControls contact={contact} lookups={lookups} />
              {contact.profileNote ? (
                <p className="break-words rounded-lg bg-muted p-2 text-xs">{contact.profileNote}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setProfile(contact.id)}>
                  {tr('openProfile')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange({ ...value, contact: undefined })}
                >
                  {tr('changeContact')}
                </Button>
              </div>
            </div>
          ) : (
            <ContactSearch onSelect={(contact) => onChange({ ...value, contact })} />
          )}
          <Button className="w-full" variant="outline" onClick={() => setTab('order')}>
            <ShoppingBag />
            {tr('orderTab')}
          </Button>
        </div>
        <CustomerPanel
          conversation={c}
          busy={update.isPending}
          onChange={(body) =>
            update.mutate(
              { expectedRevision: c.revision, ...body },
              { onError: () => toast.error(tr('conflict')) },
            )
          }
        />
        <section className="space-y-3 border-t p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Package className="size-4" />
            {tr('sessionOrders')}
          </h3>
          {value.orders.length ? (
            value.orders.map((order) => (
              <Link
                key={order.id}
                to="/app/orders/$orderId"
                params={{ orderId: order.id }}
                className="block space-y-2 rounded-xl border p-3 hover:bg-muted/40"
              >
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-medium">{order.code}</span>
                  <span>{formatVnd(order.amounts.total)}</span>
                </div>
                <OrderStatusBadge status={order.status} />
              </Link>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">{tr('noSessionOrders')}</p>
          )}
        </section>
        <ContactSheet contactId={profile} onClose={() => setProfile(undefined)} lookups={lookups} />
      </TabsContent>
      <TabsContent value="order" className="m-0 p-3">
        {value.contact && !contact ? (
          <p role="status" className="p-4 text-sm">
            {t(selectedContact.isError ? 'channelInbox.loadError' : 'channelInbox.loading')}
          </p>
        ) : !canCreate ? (
          <p role="status" className="rounded-lg bg-muted p-4 text-sm">
            {tr('orderPermission')}
          </p>
        ) : created ? (
          <div className="space-y-4 rounded-xl border p-4">
            <Check className="size-8 text-success" />
            <p className="font-semibold">{t('orderForm.created', { code: created.code })}</p>
            <Button asChild variant="outline" className="w-full">
              <Link to="/app/orders/$orderId" params={{ orderId: created.id }}>
                {tr('openOrder')}
              </Link>
            </Button>
            <Button
              className="w-full"
              onClick={() => {
                onChange({ ...value, created: undefined });
                setGeneration((n) => n + 1);
              }}
            >
              {tr('anotherOrder')}
            </Button>
          </div>
        ) : (
          <InboxOrderComposer
            key={`${c.id}:${generation}`}
            context={{ draftKey: c.id, customerName: c.customerName, source: c.provider, contact }}
            onCreated={onOrderCreated}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}

function ContactSearch({ onSelect }: { onSelect: (contact: ContactDto) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm font-medium" htmlFor="inbox-contact-search">
        <Search className="size-4" />
        {t('channelInbox.sales.findContact')}
      </label>
      <Input
        id="inbox-contact-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        maxLength={100}
        placeholder={t('channelInbox.sales.contactSearchPlaceholder')}
      />
      <p className="text-xs text-muted-foreground">
        {t('channelInbox.sales.contactSelectionHint')}
      </p>
      {query ? <ContactResults key={query} query={query} onSelect={onSelect} /> : null}
    </div>
  );
}
function ContactResults({
  query,
  onSelect,
}: {
  query: string;
  onSelect: (contact: ContactDto) => void;
}) {
  const { t } = useTranslation();
  const result = useContacts({ q: query, page: 1, pageSize: 5 });
  if (result.isPending)
    return (
      <p role="status" className="text-xs">
        {t('channelInbox.loading')}
      </p>
    );
  if (result.isError)
    return (
      <Button variant="outline" onClick={() => void result.refetch()}>
        {t('channelInbox.retry')}
      </Button>
    );
  return (
    <div className="space-y-1">
      {result.data?.data.length ? (
        result.data.data.map((contact) => (
          <button
            type="button"
            key={contact.id}
            onClick={() => onSelect(contact)}
            className="block w-full rounded-lg border p-3 text-left text-sm hover:bg-muted"
          >
            <span className="block font-medium">
              {contact.name ?? contact.email ?? contact.phone}
            </span>
            <span className="text-xs text-muted-foreground">
              {[contact.phone, contact.email].filter(Boolean).join(' · ')}
            </span>
          </button>
        ))
      ) : (
        <p className="text-xs text-muted-foreground">{t('channelInbox.sales.noContacts')}</p>
      )}
    </div>
  );
}

function InboxOrderComposer({
  context,
  onCreated,
}: {
  context: InboxOrderContext;
  onCreated: (order: OrderDto) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mb-3 w-full"
        onClick={() => setExpanded(true)}
      >
        <Maximize2 />
        {t('channelInbox.sales.expandOrder')}
      </Button>
      {!expanded ? <OrderForm context={context} onCreated={onCreated} /> : null}
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex h-[92svh] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-3rem)]">
          <DialogHeader className="shrink-0 border-b p-4 pr-12">
            <DialogTitle>{t('channelInbox.sales.orderDetails')}</DialogTitle>
            <DialogDescription>{t('channelInbox.sales.orderDraftHint')}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
            <OrderForm context={context} expanded onCreated={onCreated} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
