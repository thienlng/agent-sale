interface CommentState {
  commentId: string;
  version: string;
  actions: readonly { kind: string; externalId: string | null; status: string; text: string }[];
}
interface CommentEvent {
  externalEventId: string;
  senderExternalId: string;
  occurredAt: Date | string;
  text?: string;
  comment?: { commentId: string; parentId: string | null; operation: string };
}
/** Own sent replies do not pause automation; external staff replies and newer edits do. */
export function interruptsComment(c: CommentState, event: CommentEvent, pageId: string): boolean {
  const detail = event.comment;
  if (!detail) return false;
  if (detail.parentId === c.commentId && event.senderExternalId === pageId) {
    return !c.actions.some(
      (a) =>
        a.kind === 'public_reply' &&
        (a.externalId === detail.commentId ||
          ((a.status === 'pending' || a.status === 'unknown') && a.text === event.text)),
    );
  }
  if (detail.commentId !== c.commentId || c.version.endsWith(`/${event.externalEventId}`))
    return false;
  return new Date(event.occurredAt).getTime() >= Date.parse(c.version.slice(0, 24));
}
