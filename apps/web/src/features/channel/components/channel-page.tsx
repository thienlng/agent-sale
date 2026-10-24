import {
  Cable,
  CheckCircle2,
  CircleHelp,
  MessageCircle as Facebook,
  Camera as Instagram,
  Loader2,
  Plus,
  RefreshCw,
  Unplug,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useChannelBots,
  useChannels,
  useDiscovery,
  useSelectAccounts,
  useUpdateChannel,
} from '../api/channels';
import { useMetaConnect } from '../hooks/use-meta-connect';
export function ChannelPage() {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  const channels = useChannels(),
    bots = useChannelBots(),
    update = useUpdateChannel();
  const [discoveryId, setDiscoveryId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const connect = useMetaConnect((id) => {
    setSelected([]);
    setDiscoveryId(id);
  });
  const discovery = useDiscovery(discoveryId);
  const save = useSelectAccounts();
  async function saveSelection() {
    if (!discoveryId) return;
    try {
      await save.mutateAsync({ id: discoveryId, externalIds: selected });
      setDiscoveryId(null);
      toast.success(tr('saved'));
    } catch {
      toast.error(tr('connectionError'));
    }
  }
  async function change(id: string, body: { botId?: string | null; disconnect?: true }) {
    try {
      await update.mutateAsync({ id, body });
      toast.success(tr('updated'));
    } catch {
      toast.error(tr('loadError'));
    }
  }
  return (
    <section className="w-full space-y-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tr('channelsTitle')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{tr('channelsSubtitle')}</p>
        </div>
        <Badge variant="secondary">
          <Cable className="mr-1 size-3.5" />
          Meta
        </Badge>
      </header>
      {channels.isError ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm"
        >
          <p>{tr('loadError')}</p>
          <Button variant="outline" className="mt-3" onClick={() => void channels.refetch()}>
            {tr('retry')}
          </Button>
        </div>
      ) : null}
      {connect.error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {tr(connect.error)}
        </p>
      ) : null}
      {connect.pending ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 p-4"
        >
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">{tr('connecting')}</span>
          <Button variant="outline" onClick={connect.cancel}>
            {tr('cancel')}
          </Button>
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {(['facebook', 'instagram'] as const).map((provider) => {
          const configured = channels.data?.providers.find(
            (p) => p.provider === provider,
          )?.configured;
          const Icon = provider === 'facebook' ? Facebook : Instagram;
          return (
            <Card key={provider} className="gap-0 py-0">
              <CardContent className="flex flex-col gap-5 p-5 sm:p-6">
                <div className="flex items-start gap-4">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary">
                    <Icon className="size-6" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">
                        {provider === 'facebook' ? 'Facebook' : 'Instagram'}
                      </h2>
                      {!channels.isPending ? (
                        <Badge
                          variant="secondary"
                          className={configured ? 'bg-success-soft text-success' : undefined}
                        >
                          {tr(configured ? 'configured' : 'unconfigured')}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {tr(`${provider}Body`)}
                    </p>
                  </div>
                </div>
                {!channels.isPending && !configured ? (
                  <p className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                    {tr('setupBody')}
                  </p>
                ) : null}
                <Button
                  className="self-start"
                  disabled={
                    channels.isPending || channels.isError || !configured || connect.pending
                  }
                  onClick={() => connect.connect(provider)}
                >
                  <Plus className="size-4" />
                  {tr('connect')}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{tr('connections')}</h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label={tr('refresh')}
            onClick={() => void channels.refetch()}
          >
            <RefreshCw />
          </Button>
        </div>
        {channels.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : channels.data?.data.length ? (
          <div className="space-y-3">
            {channels.data.data.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-4 rounded-xl border p-4">
                <span className="grid size-10 place-items-center rounded-full bg-muted">
                  {c.provider === 'facebook' ? (
                    <Facebook className="size-5" />
                  ) : (
                    <Instagram className="size-5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {c.provider === 'facebook' ? 'Facebook' : 'Instagram'} · {c.externalId}
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className={c.status === 'connected' ? 'bg-success-soft text-success' : undefined}
                >
                  {c.status === 'connected' ? <CheckCircle2 className="mr-1 size-3" /> : null}
                  {tr(c.status)}
                </Badge>
                <div className="w-full sm:w-52">
                  <Label className="mb-1.5 text-xs">{tr('bot')}</Label>
                  <Select
                    value={c.botId ?? 'none'}
                    disabled={
                      c.status !== 'connected' || update.isPending || bots.isPending || bots.isError
                    }
                    onValueChange={(id) => void change(c.id, { botId: id === 'none' ? null : id })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tr('noBot')}</SelectItem>
                      {bots.data?.map((bot) => (
                        <SelectItem key={bot.id} value={bot.id}>
                          {bot.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {c.status === 'connected' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={update.isPending}
                    onClick={() => void change(c.id, { disconnect: true })}
                  >
                    <Unplug />
                    {tr('disconnect')}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    disabled={
                      connect.pending ||
                      !channels.data?.providers.find((p) => p.provider === c.provider)?.configured
                    }
                    onClick={() => connect.connect(c.provider)}
                  >
                    {tr('reconnect')}
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : !channels.isError ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed p-10 text-center">
            <Cable className="mb-3 size-9 text-muted-foreground" />
            <h3 className="font-medium">{tr('emptyConnections')}</h3>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              {tr('emptyConnectionsBody')}
            </p>
          </div>
        ) : null}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <CircleHelp className="mt-0.5 size-3.5 shrink-0" />
          {tr('botHint')}
        </p>
      </section>
      <div className="grid gap-3 sm:grid-cols-3">
        {['Zalo OA', 'TikTok', 'Lazada'].map((name) => (
          <div
            key={name}
            className="flex items-center justify-between rounded-xl border border-dashed bg-muted/20 p-4"
          >
            <span className="text-sm font-medium text-muted-foreground">{name}</span>
            <Badge variant="outline">{tr('unavailable')}</Badge>
          </div>
        ))}
      </div>
      <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">{tr('consentHint')}</p>
      <Dialog
        open={Boolean(discoveryId)}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setDiscoveryId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr('choose')}</DialogTitle>
            <DialogDescription>{tr('selectAccounts')}</DialogDescription>
          </DialogHeader>
          {discovery.isPending ? (
            <Skeleton className="h-24" />
          ) : discovery.isError ? (
            <p role="alert" className="text-sm text-destructive">
              {tr('connectionError')}
            </p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {discovery.data?.accounts.map((a) => (
                <Label
                  key={a.externalId}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-4"
                >
                  <Checkbox
                    checked={selected.includes(a.externalId)}
                    onCheckedChange={(checked) =>
                      setSelected((prev) =>
                        checked
                          ? [...prev, a.externalId]
                          : prev.filter((id) => id !== a.externalId),
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{a.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {a.externalId}
                    </span>
                  </span>
                </Label>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={save.isPending}
              onClick={() => setDiscoveryId(null)}
            >
              {tr('cancel')}
            </Button>
            <Button
              disabled={save.isPending || !selected.length || discovery.isError}
              onClick={() => void saveSelection()}
            >
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              {tr('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
