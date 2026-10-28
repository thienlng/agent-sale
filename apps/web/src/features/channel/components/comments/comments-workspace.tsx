import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/permissions';
import { useSession } from '@/lib/session';
import { storage } from '@/lib/storage';
import { useWorkspaceId } from '@/lib/use-workspace';
import { useChannels } from '../../api/channels';
import { CommentsPane } from './comments-pane';
import { ChannelsLink, State, commentsT } from './comments-shared';

/**
 * Facebook comments inside Inbox, for one Page at a time. Rendered by the Inbox route through
 * a slot, so the conversation feature never imports channel internals.
 */
export function CommentsWorkspace() {
  const { t } = useTranslation();
  const tr = (key: string) => t(`${commentsT}.${key}`);
  const ws = useWorkspaceId();
  const userId = useSession()?.user.id ?? '';
  const channels = useChannels();
  const canManage = useCan('settings.manage');
  const memory = `rapiz.inbox.commentsPage.${userId}.${ws}`;
  const [chosen, setChosen] = useState(() => storage.get(memory));
  if (channels.isPending) return <State title={tr('loadingPages')} busy />;
  if (channels.isError)
    return (
      <State title={tr('pagesError')} alert>
        <Button variant="outline" className="mt-4" onClick={() => void channels.refetch()}>
          {tr('retry')}
        </Button>
      </State>
    );
  const pages = channels.data.data.filter(
    (c) => c.provider === 'facebook' && c.status !== 'disconnected',
  );
  if (!pages.length)
    return (
      <State title={tr('noPageTitle')} body={tr('noPageBody')}>
        {canManage ? <ChannelsLink label={tr('connectPage')} /> : null}
      </State>
    );
  // The sole Page opens directly; with several, a still-available earlier choice is restored.
  const page = pages.length === 1 ? pages[0] : pages.find((p) => p.id === chosen);
  function choose(id: string) {
    setChosen(id);
    storage.set(memory, id);
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {pages.length > 1 ? (
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <label htmlFor="comments-page" className="text-sm text-muted-foreground">
            {tr('page')}
          </label>
          <select
            id="comments-page"
            className="h-8 min-w-0 max-w-full flex-1 rounded-md border bg-background px-2 text-sm md:max-w-xs"
            value={page?.id ?? ''}
            onChange={(e) => choose(e.target.value)}
          >
            {!page ? <option value="">{tr('choosePage')}</option> : null}
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {page ? (
        // A new Page starts clean: selection, loaded pages, filters and confirmations reset.
        <CommentsPane key={page.id} page={page} canManage={canManage} />
      ) : (
        <State title={tr('choosePageTitle')} />
      )}
    </div>
  );
}
