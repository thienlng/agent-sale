import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useCommentPosts, useLatestPosts } from '../../api/fanpage-comments';
import { useDebounced } from './use-debounced';
import { CommentDetail } from './comment-detail';
import { CommentList } from './comment-list';
import {
  ChannelsLink,
  State,
  commentsT,
  pageUsable,
  type FacebookPage,
  type PostLabel,
} from './comments-shared';

/** One Page: post filter and server-side search over stored comments, list and detail. */
export function CommentsPane({ page, canManage }: { page: FacebookPage; canManage: boolean }) {
  const { t } = useTranslation();
  const tr = (key: string, o?: Record<string, unknown>) => t(`${commentsT}.${key}`, o ?? {});
  const [postId, setPostId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 300);
  const [selected, setSelected] = useState<string | null>(null);
  const known = useCommentPosts(page.id);
  const latest = useLatestPosts(page.id);
  // Stored posts are always listed; Facebook's latest posts only add text to their labels.
  // A post can move to the top between page loads (new activity): list it once.
  const stored = [
    ...new Map((known.data?.pages.flatMap((p) => p.data) ?? []).map((p) => [p.postId, p])).values(),
  ];
  const posts: PostLabel[] = stored.map((p) => {
    const text = p.text ?? latest.data?.data.find((l) => l.id === p.postId)?.text ?? '';
    return {
      postId: p.postId,
      label: text.trim()
        ? text.trim().slice(0, 60)
        : tr('postFallback', { id: p.postId.split('_')[1] ?? p.postId }),
    };
  });
  const usable = pageUsable(page, Date.now());
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!usable ? (
        <div role="alert" className="shrink-0 border-b bg-muted/60 px-3 py-2 text-sm">
          {tr('reconnect', { page: page.name })}
          {canManage ? <ChannelsLink label={tr('openChannels')} /> : null}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            'flex min-h-0 w-full shrink-0 flex-col border-r md:w-[340px]',
            selected && 'hidden md:flex',
          )}
        >
          <div className="space-y-2 border-b p-3">
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tr('search')}
              aria-label={tr('search')}
              maxLength={200}
            />
            <select
              aria-label={tr('post')}
              className="h-8 w-full rounded-md border bg-background px-2 text-sm"
              value={postId ?? ''}
              onChange={(e) => setPostId(e.target.value || null)}
            >
              <option value="">{tr('allPosts')}</option>
              {posts.map((p) => (
                <option key={p.postId} value={p.postId}>
                  {p.label}
                </option>
              ))}
            </select>
            {known.hasNextPage ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-full"
                disabled={known.isFetchingNextPage}
                onClick={() => void known.fetchNextPage()}
              >
                {known.isFetchingNextPage ? tr('loadingPosts') : tr('morePosts')}
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">{tr('scope')}</p>
          </div>
          <CommentList
            page={page.id}
            filter={{ postId, q: query }}
            filtered={Boolean(postId || query)}
            selected={selected}
            onSelect={setSelected}
            posts={posts}
          />
        </div>
        <div className={cn('min-h-0 min-w-0 flex-1', selected ? 'flex' : 'hidden md:flex')}>
          {selected ? (
            <CommentDetail
              key={selected}
              page={page}
              usable={usable}
              commentId={selected}
              posts={posts}
              onBack={() => setSelected(null)}
            />
          ) : (
            <State title={tr('selectTitle')} body={tr('selectBody')} />
          )}
        </div>
      </div>
    </div>
  );
}
