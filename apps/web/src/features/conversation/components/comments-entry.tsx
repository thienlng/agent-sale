import { Link } from '@tanstack/react-router';
import { MessagesSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

/**
 * Facebook comments are handled by the Page's comment automation screen, not as inbox threads
 * yet; this tab says so and leads there instead of showing a list that does not exist.
 */
export function CommentsEntry() {
  const { t } = useTranslation();
  const tr = (key: string) => t(`channelInbox.meta.comments.${key}`);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8 text-center">
      <MessagesSquare className="mb-3 size-10 text-muted-foreground" aria-hidden />
      <h2 className="text-base font-semibold">{tr('title')}</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{tr('body')}</p>
      <Button asChild className="mt-5">
        <Link to="/app/channels">{tr('open')}</Link>
      </Button>
    </div>
  );
}
