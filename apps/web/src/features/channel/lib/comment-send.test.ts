import type { FanpageAction, FanpageCommentDetail } from '@agent-sales/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/lib/api-client';
import { clearAll, draftKey, readDraft, setDraftText } from './comment-drafts';
import { reconcileDraft, sendDraft } from './comment-send';

const key = draftKey({
  userId: 'u',
  workspaceId: 'w',
  connectionId: 'p',
  commentId: '1_2',
  mode: 'public_reply',
});
const where = { workspaceId: 'w', page: 'p', commentId: '1_2' };
const request = { ...where, kind: 'public_reply' as const, version: 'v1' };
const action = (id: string, status: FanpageAction['status']): FanpageAction => ({
  id,
  kind: 'public_reply',
  status,
  text: 'Hi',
  reason: 'Manual staff action',
  externalId: null,
  actorId: null,
  recipientId: null,
  failureCode: null,
  createdAt: new Date().toISOString(),
});
const detail = (actions: FanpageAction[]) =>
  ({ data: { actions } }) as unknown as FanpageCommentDetail;
afterEach(clearAll);

describe('sendDraft', () => {
  it('clears the draft only when its own action is confirmed sent', async () => {
    setDraftText(key, 'Hi');
    const send = vi.fn(async (r: { requestId: string }) => ({
      action: action(r.requestId, 'sent'),
    }));
    await sendDraft({ send, reload: vi.fn() }, key, request);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hi', version: 'v1' }));
    expect(readDraft(key)).toMatchObject({ text: '', attempt: null });
  });

  it('retries a timeout with the same request id and never resends by itself', async () => {
    setDraftText(key, 'Hi');
    const send = vi.fn().mockRejectedValueOnce(new TypeError('network'));
    await sendDraft({ send, reload: vi.fn() }, key, request);
    expect(send).toHaveBeenCalledTimes(1);
    const first = readDraft(key).attempt!;
    expect(first.state).toBe('unconfirmed');
    send.mockImplementationOnce(async (r: { requestId: string }) => ({
      action: action(r.requestId, 'sent'),
    }));
    await sendDraft({ send, reload: vi.fn() }, key, request);
    expect(send.mock.calls[1]![0].requestId).toBe(first.requestId);
    expect(readDraft(key).text).toBe('');
  });

  it('keeps a recorded pending attempt locked to its request id until it is final', async () => {
    setDraftText(key, 'Hi');
    // The first request times out while the server is still sending it.
    const send = vi.fn().mockRejectedValueOnce(new TypeError('timeout'));
    await sendDraft({ send, reload: vi.fn() }, key, request);
    const first = readDraft(key).attempt!;
    // The same-id retry is recognised (no new action), and the record says it is still pending.
    send.mockResolvedValue({ action: null });
    const reload = vi.fn(async () => detail([action(first.requestId, 'pending')]));
    await sendDraft({ send, reload }, key, request);
    expect(readDraft(key)).toMatchObject({ attempt: { state: 'pending' } });
    // Typing is ignored and the next Send still carries the first id: no second public reply.
    setDraftText(key, 'Hi again');
    await sendDraft({ send, reload }, key, request);
    expect(send.mock.calls.map((c) => c[0].requestId)).toEqual([
      first.requestId,
      first.requestId,
      first.requestId,
    ]);
    expect(send.mock.calls[2]![0].text).toBe('Hi');
    // Checking status adopts the final outcome once it is recorded.
    await reconcileDraft(
      { send, reload: async () => detail([action(first.requestId, 'sent')]) },
      key,
      first.requestId,
      where,
    );
    expect(readDraft(key)).toMatchObject({ text: '', attempt: null });
  });

  it('treats a null action as unconfirmed and matches the stored record by request id', async () => {
    setDraftText(key, 'Hi');
    const send = vi.fn(async () => ({ action: null }));
    await sendDraft(
      { send, reload: async () => detail([action('someone-else', 'sent')]) },
      key,
      request,
    );
    expect(readDraft(key)).toMatchObject({ text: 'Hi', attempt: { state: 'unmatched' } });
    await sendDraft(
      {
        send: vi.fn(async () => ({ action: null })),
        // The answer had no action, but the stored record has one under this request id.
        reload: async () => detail([action(readDraft(key).attempt!.requestId, 'unknown')]),
      },
      key,
      request,
    );
    expect(readDraft(key)).toMatchObject({ text: 'Hi', attempt: { state: 'unknown' } });
  });

  it('keeps the text after a refusal and reports its code', async () => {
    setDraftText(key, 'Hi');
    const send = vi.fn().mockRejectedValue(new ApiClientError(409, 'CONFLICT', 'stale'));
    await sendDraft({ send, reload: vi.fn() }, key, request);
    expect(readDraft(key)).toMatchObject({
      text: 'Hi',
      attempt: { state: 'rejected', code: 'CONFLICT' },
    });
  });

  it('treats an unavailable Page as a refusal before anything was reserved', async () => {
    setDraftText(key, 'Hi');
    const send = vi.fn().mockRejectedValue(new ApiClientError(503, 'UNAVAILABLE', 'Reconnect'));
    await sendDraft({ send, reload: vi.fn() }, key, request);
    expect(readDraft(key)).toMatchObject({
      text: 'Hi',
      attempt: { state: 'rejected', code: 'UNAVAILABLE' },
    });
  });

  it('adopts a recorded outcome when the status is checked later', async () => {
    setDraftText(key, 'Hi');
    await sendDraft(
      { send: vi.fn().mockRejectedValue(new TypeError('x')), reload: vi.fn() },
      key,
      request,
    );
    const id = readDraft(key).attempt!.requestId;
    await reconcileDraft({ send: vi.fn(), reload: async () => detail([]) }, key, id, where);
    expect(readDraft(key).attempt?.state).toBe('unconfirmed');
    await reconcileDraft(
      { send: vi.fn(), reload: async () => detail([action(id, 'sent')]) },
      key,
      id,
      where,
    );
    expect(readDraft(key)).toMatchObject({ text: '', attempt: null });
  });
});
