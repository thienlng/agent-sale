import type { FanpageComment } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCommentList, type CommentFilter } from '../../api/fanpage-comments';
import { history, shortId, visibility } from '../../lib/comment-state';
import { State, commentsT, type PostLabel } from './comments-shared';

export function CommentList({
  page,
  filter,
  filtered,
  selected,
  onSelect,
  posts,
}: {
  page: string;
  filter: CommentFilter;
  filtered: boolean;
  selected: string | null;
  onSelect: (commentId: string) => void;
  posts: PostLabel[];
}) {
  const { t } = useTranslation();
  const tr = (key: string, o?: Record<string, unknown>) => t(`${commentsT}.${key}`, o ?? {});
  const list = useCommentList(page, filter);
  if (list.isPending) return <State title={tr('loading')} busy />;
  if (list.isError && !list.data)
    return (
      <State title={tr('listError')} alert>
        <Button variant="outline" className="mt-4" onClick={() => void list.refetch()}>
          {tr('retry')}
        </Button>
      </State>
    );
  // Refetched pages can shift by a row while new comments arrive: show each record once.
  const seen = new Set<string>();
  const rows = list.data.pages
    .flatMap((p) => p.data)
    .filter((c) => !seen.has(c.commentId) && Boolean(seen.add(c.commentId)));
  if (!rows.length)
    return (
      <State
        title={filtered ? tr('noMatchTitle') : tr('emptyTitle')}
        body={filtered ? tr('noMatchBody') : tr('emptyBody')}
      />
    );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {list.isError ? (
        <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">
          {tr('refreshError')}
        </p>
      ) : null}
      <ul aria-label={tr('listLabel')}>
        {rows.map((c) => (
          <li key={c.commentId}>
            <Row
              comment={c}
              active={c.commentId === selected}
              post={posts.find((p) => p.postId === c.postId)?.label}
              onSelect={() => onSelect(c.commentId)}
            />
          </li>
        ))}
      </ul>
      {list.hasNextPage ? (
        <div className="p-3">
          <Button
            variant="outline"
            className="w-full"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? tr('loadingMore') : tr('loadMore')}
          </Button>
        </div>
      ) : (
        <p className="p-3 text-center text-xs text-muted-foreground">{tr('end')}</p>
      )}
    </div>
  );
}

function Row({
  comment: c,
  active,
  post,
  onSelect,
}: {
  comment: FanpageComment;
  active: boolean;
  post: string | undefined;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, o?: Record<string, unknown>) => t(`${commentsT}.${key}`, o ?? {});
  const last = history(c).at(-1);
  const shown = visibility(c);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      aria-label={`${tr('author', { id: shortId(c.authorId) })}: ${c.text || tr('noText')}`}
      className={cn(
        'flex w-full flex-col gap-1 border-b px-3 py-2.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring',
        active && 'bg-muted',
      )}
    >
      <span className="flex items-baseline gap-2">
        <span className="truncate text-sm font-medium">
          {tr('author', { id: shortId(c.authorId) })}
        </span>
        <time className="ml-auto shrink-0 text-xs text-muted-foreground" dateTime={c.occurredAt}>
          {formatDateTime(c.occurredAt)}
        </time>
      </span>
      <span className={cn('line-clamp-2 text-sm', !c.text && 'italic text-muted-foreground')}>
        {c.text || tr('noText')}
      </span>
      {post ? <span className="truncate text-xs text-muted-foreground">{post}</span> : null}
      <span className="flex flex-wrap gap-1">
        {c.deleted ? <Badge variant="destructive">{tr('deleted')}</Badge> : null}
        {c.needsReview && !c.deleted ? <Badge variant="secondary">{tr('review')}</Badge> : null}
        {shown !== 'visible' ? <Badge variant="outline">{tr(`visibility.${shown}`)}</Badge> : null}
        {last ? (
          <Badge variant="outline">
            {tr(`kind.${last.kind}`)} · {tr(`status.${last.status}`)}
          </Badge>
        ) : null}
      </span>
    </button>
  );
}
