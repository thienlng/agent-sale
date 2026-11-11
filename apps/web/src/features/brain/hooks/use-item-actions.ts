import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ApiClientError } from '@/lib/api-client';

import { useDismissTodayItem, useEvaluateConversation, useReplyDraft } from '../api/brain';

/**
 * The actions of a customer on Today and in the inbox panel: draft a reply (then open the inbox
 * with it in the composer, never sent), re-evaluate, dismiss.
 */
export function useItemActions() {
  const { t } = useTranslation('brain');
  const navigate = useNavigate();
  const draft = useReplyDraft();
  const evaluate = useEvaluateConversation();
  const dismiss = useDismissTodayItem();

  return {
    drafting: draft.isPending ? draft.variables : undefined,
    evaluating: evaluate.isPending ? evaluate.variables : undefined,
    draftReply: (conversationId: string) =>
      draft.mutate(conversationId, {
        onSuccess: ({ text }) => {
          toast.success(t('draft.ready'));
          void navigate({
            to: '/app/inbox',
            search: { conversation: conversationId, draft: text },
          });
        },
        onError: (e) =>
          toast.error(
            e instanceof ApiClientError && e.code === 'RATE_LIMITED'
              ? t('draft.capped')
              : t('draft.failed'),
          ),
      }),
    evaluate: (conversationId: string) =>
      evaluate.mutate(conversationId, {
        onSuccess: (r) =>
          r.status === 'ok'
            ? toast.success(t('evaluate.ok'))
            : toast.info(t(`evaluate.${r.status}`)),
        onError: () => toast.error(t('evaluate.failed')),
      }),
    dismiss: (conversationId: string) =>
      dismiss.mutate(conversationId, {
        onSuccess: () => toast.success(t('item.dismissed')),
        onError: () => toast.error(t('evaluate.failed')),
      }),
  };
}
