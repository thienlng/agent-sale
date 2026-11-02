import {
  PUBLIC_EVENT_TYPES,
  type PublicEventType,
  WebhookUrl,
  type WebhookEndpointDto,
} from '@agent-sales/contracts';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/lib/errors';

import { useCreateWebhookEndpoint, useUpdateWebhookEndpoint } from '../api/developer';

/** Public event types grouped by area (`crm`, `lodging`, `commerce`, `saas`), in catalog order. */
const EVENT_GROUPS = PUBLIC_EVENT_TYPES.reduce<Record<string, PublicEventType[]>>(
  (groups, type) => {
    const area = type.split('.')[0] ?? type;
    (groups[area] ??= []).push(type);
    return groups;
  },
  {},
);

/**
 * Add a webhook (`endpoint` null; the signing secret goes to `onCreated`, shown once) or change
 * one (URL, description, events, enabled).
 */
export function WebhookEndpointDialog({
  open,
  endpoint,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  endpoint: WebhookEndpointDto | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (secret: string) => void;
}) {
  const { t } = useTranslation('developer');
  const { t: tc } = useTranslation();
  const create = useCreateWebhookEndpoint();
  const update = useUpdateWebhookEndpoint();
  const pending = create.isPending || update.isPending;
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<PublicEventType[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setUrl(endpoint?.url ?? '');
      setDescription(endpoint?.description ?? '');
      setEvents(endpoint?.events ?? []);
      setEnabled(endpoint?.enabled ?? true);
      setError(null);
    }
  }

  const toggle = (type: PublicEventType, on: boolean) =>
    setEvents((current) =>
      on
        ? PUBLIC_EVENT_TYPES.filter((e) => e === type || current.includes(e))
        : current.filter((e) => e !== type),
    );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!WebhookUrl.safeParse(url.trim()).success) return setError(t('webhooks.form.urlInvalid'));
    if (!events.length) return setError(t('webhooks.form.eventsRequired'));
    setError(null);
    const body = { url: url.trim(), description: description.trim(), events };
    try {
      if (endpoint) {
        await update.mutateAsync({
          id: endpoint.id,
          body: { ...body, enabled, version: endpoint.version },
        });
        toast.success(t('webhooks.saved'));
        onOpenChange(false);
      } else {
        const created = await create.mutateAsync(body);
        onOpenChange(false);
        onCreated(created.secret);
      }
    } catch (err) {
      setError(errorMessage(tc, err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>
              {endpoint ? t('webhooks.form.editTitle') : t('webhooks.form.createTitle')}
            </DialogTitle>
            <DialogDescription>{t('webhooks.hint')}</DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-2">
            <Label htmlFor="webhook-url">{t('webhooks.form.url')}</Label>
            <Input
              id="webhook-url"
              type="url"
              inputMode="url"
              placeholder="https://example.com/rapiz/webhook"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="webhook-description">{t('webhooks.form.description')}</Label>
            <Input
              id="webhook-description"
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">{t('webhooks.form.events')}</legend>
            {Object.entries(EVENT_GROUPS).map(([area, types]) => (
              <div key={area} className="grid gap-2 sm:grid-cols-2">
                {types.map((type) => (
                  <Label key={type} className="flex items-start gap-2 font-normal">
                    <Checkbox
                      className="mt-0.5"
                      checked={events.includes(type)}
                      onCheckedChange={(on) => toggle(type, on === true)}
                    />
                    <span className="flex flex-col">
                      {t(`events.${type}`)}
                      <code className="font-mono text-xs text-muted-foreground">{type}</code>
                    </span>
                  </Label>
                ))}
              </div>
            ))}
          </fieldset>
          {endpoint ? (
            <Label className="flex items-center gap-3 font-normal">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              {t('webhooks.form.enabled')}
            </Label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle aria-hidden className="motion-safe:animate-spin" /> : null}
              {t('webhooks.form.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
