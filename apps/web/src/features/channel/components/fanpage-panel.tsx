import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useCan } from '@/lib/permissions';
import { useChannels } from '../api/channels';
import { useFanpageForm } from '../hooks/use-fanpage-form';
export function FanpagePanel() {
  const { t } = useTranslation();
  const channels = useChannels(),
    [selected, setSelected] = useState('');
  const pages =
    channels.data?.data.filter((c) => c.provider === 'facebook' && c.status !== 'disconnected') ??
    [];
  const id = pages.some((p) => p.id === selected) ? selected : pages[0]?.id;
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">{t('channelInbox.fanpage.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('channelInbox.fanpage.description')}</p>
      {channels.isLoading ? (
        <p>{t('channelInbox.fanpage.loading')}</p>
      ) : channels.isError ? (
        <p role="alert">{t('channelInbox.fanpage.error')}</p>
      ) : !id ? (
        <p>{t('channelInbox.fanpage.noPages')}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {pages.map((p) => (
              <Button
                key={p.id}
                className="max-w-full"
                variant={p.id === id ? 'default' : 'outline'}
                onClick={() => setSelected(p.id)}
              >
                <span className="truncate">{p.name}</span>
              </Button>
            ))}
          </div>
          <FanpageDetails key={id} id={id} />
        </>
      )}
    </section>
  );
}
function FanpageDetails({ id }: { id: string }) {
  const { t } = useTranslation(),
    f = useFanpageForm(id),
    canManage = useCan('settings.manage'),
    tr = (key: string) => t(`channelInbox.fanpage.${key}`);
  if (f.settings.isLoading) return <p>{tr('loading')}</p>;
  if (f.settings.isError) return <p role="alert">{tr('error')}</p>;
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{tr('permissions')}</p>
      {!canManage && <p className="text-sm text-muted-foreground">{tr('readOnlySettings')}</p>}
      <fieldset disabled={!canManage} className="space-y-5">
        {(['publicReplies', 'privateReplies', 'hideComments'] as const).map((key) => (
          <label key={key} className="flex items-center gap-3">
            <Switch
              disabled={!canManage}
              checked={f.value[key]}
              onCheckedChange={(v) => f.patch({ [key]: v })}
            />
            <span>{tr(key)}</span>
          </label>
        ))}
        <label className="block space-y-2">
          <span>{tr('keywords')}</span>
          <Textarea value={f.keywords} onChange={(e) => f.setKeywords(e.target.value)} />
        </label>
        <p className="text-sm text-muted-foreground">{tr('moderationHelp')}</p>
        {canManage && (
          <Button onClick={f.saveForm} disabled={f.save.isPending}>
            {tr('save')}
          </Button>
        )}
        {f.save.isSuccess && <p role="status">{tr('saved')}</p>}
        {f.save.isError && <p role="alert">{tr('error')}</p>}
      </fieldset>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{tr('posts')}</h3>
        <Button variant="outline" onClick={() => void f.refresh()}>
          {tr('refresh')}
        </Button>
      </div>
      {f.posts.isLoading ? (
        <p>{tr('loading')}</p>
      ) : f.posts.isError ? (
        <p role="alert">{tr('postError')}</p>
      ) : !f.posts.data?.data.length ? (
        <p>{tr('noPosts')}</p>
      ) : (
        <ul className="space-y-2">
          {f.posts.data.data.map((post) => (
            <li key={post.id} className="flex items-start gap-3 rounded-lg border p-3">
              <Switch
                aria-label={`${tr('enablePost')} ${post.id}`}
                disabled={!canManage}
                checked={!f.value.excludedPostIds.includes(post.id)}
                onCheckedChange={(v) => f.togglePost(post.id, v)}
              />
              <div className="min-w-0">
                <a
                  className="text-sm text-primary underline"
                  href={`https://www.facebook.com/${post.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {tr('openPost')}
                </a>
                <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">
                  {post.text || tr('mediaPost')}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <h3 className="font-semibold">{tr('comments')}</h3>
      {f.comments.isLoading ? (
        <p>{tr('loading')}</p>
      ) : f.comments.isError ? (
        <p role="alert">{tr('error')}</p>
      ) : !f.comments.data?.data.length ? (
        <p>{tr('noComments')}</p>
      ) : (
        <ul className="space-y-3">
          {f.comments.data.data.map((c) => (
            <li key={c.id} className="space-y-2 rounded-lg border p-3">
              <a
                className="text-sm text-primary underline"
                href={`https://www.facebook.com/${c.postId}`}
                target="_blank"
                rel="noreferrer"
              >
                {tr('openPost')}
              </a>
              {c.context && (
                <blockquote className="line-clamp-3 border-l-2 pl-3 text-sm text-muted-foreground">
                  {c.context.text}
                </blockquote>
              )}
              <p className="whitespace-pre-wrap break-words">{c.text}</p>
              {c.deleted ? (
                <p>{tr('deleted')}</p>
              ) : (
                <>
                  {c.needsReview && <p className="text-sm font-medium">{tr('review')}</p>}
                  {c.actions.map((a) => (
                    <div key={a.id} className="rounded bg-muted p-2 text-sm">
                      <p>
                        {tr(a.kind)} · {tr(a.status)}
                      </p>
                      <p className="whitespace-pre-wrap break-words">{a.text}</p>
                      <p className="break-words text-muted-foreground">
                        {a.reason.startsWith('Configured keyword: ')
                          ? t('channelInbox.fanpage.keywordReason', {
                              keyword: a.reason.slice('Configured keyword: '.length),
                            })
                          : a.reason === 'Manual staff action'
                            ? tr('manualReason')
                            : a.reason === 'Grounded originating-post reply'
                              ? tr('groundedReason')
                              : a.reason}
                      </p>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={f.act.isPending}
                      onClick={() => f.send(c.commentId, 'hide')}
                    >
                      {tr('hide')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={f.act.isPending}
                      onClick={() => f.send(c.commentId, 'unhide')}
                    >
                      {tr('unhide')}
                    </Button>
                    <Button variant="outline" onClick={() => f.setTarget(c.commentId)}>
                      {tr('reply')}
                    </Button>
                  </div>
                  {f.target === c.commentId && (
                    <div className="space-y-2">
                      <Textarea
                        aria-label={tr('reply')}
                        value={f.text}
                        onChange={(e) => f.setText(e.target.value)}
                        maxLength={2000}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          disabled={!f.text.trim() || f.act.isPending}
                          onClick={() => f.send(c.commentId, 'public_reply')}
                        >
                          {tr('public_reply')}
                        </Button>
                        <Button
                          disabled={!f.text.trim() || f.act.isPending}
                          onClick={() => f.send(c.commentId, 'private_reply')}
                        >
                          {tr('private_reply')}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {f.act.isError && <p role="alert">{tr('error')}</p>}
    </div>
  );
}
