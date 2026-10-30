import { Link } from '@tanstack/react-router';
import { MessagesSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useContactConversations } from '@/features/conversation/api/inbox';
import { formatDateTime } from '@/lib/format';

/**
 * A customer's inbox conversations inside the CRM profile (T-088). Composed here because the
 * conversation and crm features never import each other.
 */
export function ContactConversations({ contactId }: { contactId: string }) {
  const { t } = useTranslation();
  const result = useContactConversations(contactId);
  if (result.isPending)
    return (
      <p role="status" className="text-sm">
        {t('crm.conversations.loading')}
      </p>
    );
  if (result.isError)
    return (
      <Button variant="outline" size="sm" onClick={() => void result.refetch()}>
        {t('crm.conversations.retry')}
      </Button>
    );
  const rows = result.data.data;
  if (!rows.length)
    return (
      <p className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        <MessagesSquare className="size-5 text-primary" aria-hidden />
        {t('crm.conversations.empty')}
      </p>
    );
  return (
    <ul className="space-y-2">
      {rows.map((c) => (
        <li key={c.id}>
          <Link
            to="/app/inbox"
            search={{ conversation: c.id }}
            className="block rounded-lg border p-3 text-sm hover:bg-muted/40"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{c.customerName}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {t(`crm.conversations.provider.${c.provider}`)} · {formatDateTime(c.updatedAt)}
              </span>
            </span>
            <span className="mt-1 block truncate text-muted-foreground">{c.lastMessage}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
