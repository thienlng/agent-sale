import { Link } from '@tanstack/react-router';
import type { ChannelConnectionDto } from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { type IntegrationsMode, useIntegrations } from '../hooks/use-integrations';
import {
  BOT_PLATFORMS,
  type BotPagesPlan,
  filterConnections,
  isComingSoon,
  isMetaProvider,
  type PlatformKey,
  WORKSPACE_PLATFORMS,
} from '../lib/integrations';
import { AssignBotDialog } from './assign-bot-dialog';
import { BotPagesDialog } from './bot-pages-dialog';
import { ConfirmDialog } from './confirm-dialog';
import { ConnectButtons, ConnectNotices } from './connect-controls';
import { ConnectionCard } from './connection-card';
import { DiscoveryDialog } from './discovery-dialog';
import { IntegrationsEmpty } from './integrations-empty';
import { PageListToolbar } from './page-list-toolbar';
import { PlatformList } from './platform-list';

const EMPTY: readonly ChannelConnectionDto[] = [];

/** Platform integrations (Preny "Tích hợp nền tảng"), for the workspace or for one bot. */
export function IntegrationsView({ mode }: { mode: IntegrationsMode }) {
  const { t } = useTranslation();
  const ti = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.integrations.${key}`, options ?? {});
  const bot = mode.kind === 'bot';
  const integrations = useIntegrations(mode);
  const { channels, bots, canManage, connect, configured, botName, apply, applying, discovery } =
    integrations;
  const [category, setCategory] = useState<PlatformKey>('all');
  const [query, setQuery] = useState('');
  const [assignment, setAssignment] = useState('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<'edit' | 'deactivate' | null>(null);

  const all = channels.data?.data ?? EMPTY;
  const scope = bot ? { botId: mode.botId } : {};
  const assignmentFilter =
    !bot && assignment !== 'all'
      ? { assignedBotId: assignment === 'unassigned' ? null : assignment }
      : {};
  const visible = filterConnections(all, { category, query, ...scope, ...assignmentFilter });
  const owned = bot ? filterConnections(all, { category: 'all', query: '', ...scope }) : all;
  const picked = visible.filter((c) => selected.has(c.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  async function run(changes: Parameters<typeof apply>[0]) {
    const failed = await apply(changes);
    setSelected(new Set(failed));
    if (!failed.length) {
      setDialog(null);
    }
  }
  const deactivate = () =>
    run(picked.filter((c) => c.botId !== null).map((c) => ({ id: c.id, body: { botId: null } })));
  const assign = (botId: string | null) =>
    run(picked.filter((c) => c.status === 'connected').map((c) => ({ id: c.id, body: { botId } })));
  const savePlan = (plan: BotPagesPlan) =>
    bot &&
    run([
      ...plan.bind.map((c) => ({ id: c.id, body: { botId: mode.botId } })),
      ...plan.unbind.map((c) => ({ id: c.id, body: { botId: null } })),
    ]);

  const connectProviders = isMetaProvider(category)
    ? [category]
    : (['facebook', 'instagram'] as const);
  const showConnectHeader = isMetaProvider(category) && visible.length > 0;
  const base = bot ? owned : all;
  const providerEmpty = isMetaProvider(category) && !base.some((c) => c.provider === category);
  const emptyKind = isComingSoon(category)
    ? 'comingSoon'
    : !base.length || (providerEmpty && !query)
      ? 'empty'
      : 'noMatch';

  return (
    <section className="w-full space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{ti(bot ? 'botTitle' : 'title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ti(bot ? 'botSubtitle' : 'workspaceSubtitle')}
        </p>
        {bot ? (
          <Link
            to="/app/channels"
            className="mt-2 inline-flex text-sm font-medium text-primary hover:underline"
          >
            {ti('openInventory')}
          </Link>
        ) : null}
      </header>
      <p className="rounded-lg bg-muted/60 px-4 py-3 text-sm">
        {ti('feedbackPrefix')}{' '}
        <strong className="font-semibold text-primary">{ti('feedbackEmphasis')}</strong>
      </p>
      <ConnectNotices integrations={integrations} />
      <div className="grid grid-cols-1 overflow-hidden rounded-xl border md:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="min-w-0 border-b p-2 md:border-r md:border-b-0 md:p-0 md:py-2">
          <PlatformList
            platforms={bot ? BOT_PLATFORMS : WORKSPACE_PLATFORMS}
            value={category}
            onChange={(key) => {
              setCategory(key);
              setSelected(new Set());
            }}
          />
        </div>
        <div className="min-w-0 space-y-4 p-4 sm:p-5">
          <PageListToolbar
            bot={bot}
            query={query}
            onQueryChange={(value) => {
              setQuery(value);
              setSelected(new Set());
            }}
            bots={bots.data ?? []}
            assignment={assignment}
            onAssignmentChange={(value) => {
              setAssignment(value);
              setSelected(new Set());
            }}
            readOnly={!canManage}
            canUnassign={picked.some((c) => c.botId !== null)}
            selectedCount={picked.length}
            totalCount={visible.length}
            editEnabled={
              canManage &&
              (bot
                ? !channels.isPending && !channels.isError
                : picked.some((c) => c.status === 'connected'))
            }
            busy={applying}
            onToggleAll={(on) => setSelected(new Set(on ? visible.map((c) => c.id) : []))}
            onEdit={() => setDialog('edit')}
            onDeactivate={() => setDialog('deactivate')}
          />
          {showConnectHeader ? (
            <ConnectButtons providers={connectProviders} integrations={integrations} />
          ) : null}
          {channels.isPending ? (
            <Skeleton className="h-28 w-full" />
          ) : visible.length ? (
            <ul className="grid gap-3 xl:grid-cols-2">
              {visible.map((c) => (
                <ConnectionCard
                  key={c.id}
                  connection={c}
                  checked={selected.has(c.id)}
                  disabled={!canManage || applying}
                  onCheckedChange={(on) => toggle(c.id, on)}
                  botName={botName(c.botId)}
                  showBot={!bot}
                  canReconnect={canManage && configured(c.provider) && !connect.pending}
                  onReconnect={() => connect.connect(c.provider)}
                />
              ))}
            </ul>
          ) : !channels.isError ? (
            <IntegrationsEmpty kind={emptyKind} platform={category} bot={bot}>
              {emptyKind === 'empty' ? (
                <ConnectButtons providers={connectProviders} integrations={integrations} />
              ) : null}
            </IntegrationsEmpty>
          ) : null}
        </div>
      </div>
      <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
        {t('channelInbox.consentHint')}
      </p>
      <DiscoveryDialog
        discoveryId={discovery.id}
        saving={discovery.saving}
        onClose={discovery.close}
        onSave={(ids) => void discovery.save(ids)}
      />
      {dialog === 'edit' && bot ? (
        <BotPagesDialog
          open
          botId={mode.botId}
          connections={all}
          botName={botName}
          saving={applying}
          onClose={() => setDialog(null)}
          onSave={(plan) => void savePlan(plan)}
        />
      ) : null}
      {dialog === 'edit' && !bot ? (
        <AssignBotDialog
          open
          count={picked.filter((c) => c.status === 'connected').length}
          assignedBotIds={picked.filter((c) => c.status === 'connected').map((c) => c.botId)}
          bots={bots.data ?? []}
          initialBotId={picked.length === 1 ? (picked[0]?.botId ?? null) : null}
          saving={applying}
          onClose={() => setDialog(null)}
          onSave={(botId) => void assign(botId)}
        />
      ) : null}
      <ConfirmDialog
        open={dialog === 'deactivate'}
        destructive
        title={ti('deactivateTitle', { count: picked.filter((c) => c.botId !== null).length })}
        body={ti('botDeactivateBody')}
        confirm={ti('deactivate')}
        onCancel={() => setDialog(null)}
        onConfirm={() => void deactivate()}
      />
    </section>
  );
}
