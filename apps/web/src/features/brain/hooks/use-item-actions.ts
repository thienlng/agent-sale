import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ApiClientError } from '@/lib/api-client';
import { putPendingDraft } from '@/lib/pending-reply-draft';
import { useWorkspaceId } from '@/lib/use-workspace';

import {
  useDismissTodayItem,
  useEvaluateConversation,
  useReplyDraft,
  useUndismissTodayItem,
} from '../api/brain';

const draftToast = (conversationId: string) => `reply-draft:${conversationId}`;

/**
 * The actions of a customer on Today and in the inbox panel: draft a reply (kept in memory, then
 * the inbox opens with it in the composer, never sent), re-evaluate, dismiss (with undo).
 */
export function useItemActions() {
  const { t } = useTranslation('brain');
  const router = useRouter();
  const ws = useWorkspaceId();
  const open = (conversationId: string) =>
    void router.navigate({ to: '/app/inbox', search: { conversation: conversationId } });
  const draft = useReplyDraft({
    // From the mutation itself: the draft is kept even when the member left Today meanwhile.
    onDrafted: (conversationId, text) => {
      putPendingDraft(ws, conversationId, text);
      if (router.state.location.pathname === '/app/today') {
        toast.success(t('draft.ready'), { id: draftToast(conversationId) });
        open(conversationId);
      } else {
        toast.success(t('draft.ready'), {
          id: draftToast(conversationId),
          action: { label: t('item.draftOpen'), onClick: () => open(conversationId) },
        });
      }
    },
    onFailed: (conversationId, e) =>
      toast.error(
        e instanceof ApiClientError && e.code === 'RATE_LIMITED'
          ? t('draft.capped')
          : t('draft.failed'),
        { id: draftToast(conversationId) },
      ),
  });
  const evaluate = useEvaluateConversation();
  const dismiss = useDismissTodayItem();
  const undismiss = useUndismissTodayItem();

  return {
    drafting: draft.isPending ? draft.variables : undefined,
    evaluating: evaluate.isPending ? evaluate.variables : undefined,
    draftReply: (conversationId: string) => {
      // On a phone the action sits in a closed menu: the toast shows the call is running.
      toast.loading(t('item.drafting'), { id: draftToast(conversationId) });
      draft.mutate(conversationId);
    },
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
        onSuccess: () =>
          toast.success(t('item.dismissed'), {
            action: {
              label: t('item.undo'),
              onClick: () =>
                undismiss.mutate(conversationId, {
                  onSuccess: () => toast.success(t('item.restored')),
                  onError: () => toast.error(t('evaluate.failed')),
                }),
            },
          }),
        onError: () => toast.error(t('evaluate.failed')),
      }),
  };
}
