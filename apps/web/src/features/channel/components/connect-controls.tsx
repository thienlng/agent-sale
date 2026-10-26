import type { MetaProvider } from '@agent-sales/contracts';
import { Loader2, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { Integrations } from '../hooks/use-integrations';

const LABEL: Record<MetaProvider, string> = { facebook: 'Facebook', instagram: 'Instagram' };

/** "Kết nối Facebook/Instagram" buttons; disabled with the setup hint when not configured. */
export function ConnectButtons({
  providers,
  integrations: { channels, connect, configured, canManage },
}: {
  providers: readonly MetaProvider[];
  integrations: Integrations;
}) {
  const { t } = useTranslation();
  const loading = channels.isPending || channels.isError;
  const missing = !loading && providers.some((p) => !configured(p));
  return (
    <div className="flex flex-col items-center gap-2 sm:items-start">
      <div className="flex flex-wrap justify-center gap-2">
        {providers.map((provider) => (
          <Button
            key={provider}
            disabled={!canManage || loading || !configured(provider) || connect.pending}
            onClick={() => connect.connect(provider)}
          >
            <Plus className="size-4" />
            {t('channelInbox.integrations.connectProvider', { provider: LABEL[provider] })}
          </Button>
        ))}
      </div>
      {missing ? (
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          {t('channelInbox.setupBody')}
        </p>
      ) : null}
    </div>
  );
}

/** Load error, OAuth error and "waiting for the popup" notices. */
export function ConnectNotices({
  integrations: { channels, connect },
}: {
  integrations: Integrations;
}) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.${key}`);
  return (
    <>
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
    </>
  );
}
