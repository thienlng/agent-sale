import type { MetaProvider, UpdateChannelRequest } from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCan } from '@/lib/permissions';
import { toast } from 'sonner';
import {
  useBulkUpdateChannels,
  useChannelBots,
  useChannels,
  useRemoveChannels,
  useSelectAccounts,
} from '../api/channels';
import { useMetaConnect } from './use-meta-connect';

/** Workspace screen (all pages) or a bot's screen (only the pages that bot answers). */
export type IntegrationsMode = { kind: 'workspace' } | { kind: 'bot'; botId: string };

/** Data and actions shared by both integrations screens. */
export function useIntegrations(mode: IntegrationsMode) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.${key}`, options ?? {});
  const channels = useChannels();
  const canManage = useCan('settings.manage');
  const bots = useChannelBots();
  const bulk = useBulkUpdateChannels();
  const removal = useRemoveChannels();
  const [discoveryId, setDiscoveryId] = useState<string | null>(null);
  const connect = useMetaConnect(setDiscoveryId);
  const save = useSelectAccounts(mode.kind === 'bot' ? mode.botId : undefined);

  const configured = (provider: MetaProvider) =>
    channels.data?.providers.find((p) => p.provider === provider)?.configured ?? false;
  const botName = (id: string | null) =>
    id ? (bots.data?.find((b) => b.id === id)?.name ?? tr('integrations.unknownBot')) : null;

  /** Applies the changes; resolves true when every page was updated. */
  async function apply(changes: { id: string; body: UpdateChannelRequest }[]) {
    if (!changes.length) return [];
    if (!canManage) return changes.map((change) => change.id);
    try {
      const failed = await bulk.mutateAsync(changes);
      if (failed.length) toast.error(tr('integrations.partialError'));
      else toast.success(tr('updated'));
      return failed;
    } catch {
      toast.error(tr('loadError'));
      return changes.map((change) => change.id);
    }
  }

  /** Soft-removes the pages; resolves with the ids that failed so the caller can keep them selected. */
  async function remove(ids: string[]) {
    if (!ids.length) return [];
    if (!canManage) return ids;
    try {
      const failed = await removal.mutateAsync(ids);
      if (failed.length) toast.error(tr('integrations.removePartialError'));
      else toast.success(tr('integrations.removed', { count: ids.length }));
      return failed;
    } catch {
      toast.error(tr('loadError'));
      return ids;
    }
  }

  async function saveSelection(externalIds: string[]) {
    if (!discoveryId) return;
    try {
      const result = await save.mutateAsync({ id: discoveryId, externalIds });
      setDiscoveryId(null);
      if (result.bindFailed) toast.error(tr('integrations.bindFailed'));
      else toast.success(tr('saved'));
    } catch {
      toast.error(tr('connectionError'));
    }
  }

  return {
    channels,
    canManage,
    bots,
    connect,
    configured,
    botName,
    apply,
    applying: bulk.isPending || removal.isPending,
    remove,
    discovery: {
      id: discoveryId,
      close: () => setDiscoveryId(null),
      save: saveSelection,
      saving: save.isPending,
    },
  };
}
export type Integrations = ReturnType<typeof useIntegrations>;
