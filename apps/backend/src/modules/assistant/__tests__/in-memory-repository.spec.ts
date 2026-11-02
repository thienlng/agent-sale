import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { AssistantNotFoundError, AssistantRunIdTakenError } from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

const scope = (accountId: string): OwnerScope => ({
  accountId,
  ownerUserId: userId(newId()),
  businessId: workspaceId(newId()),
});
const run = (threadId: string) => ({
  id: newId(),
  threadId,
  tier: 'pro',
  promptVersion: 'assistant@1',
});
const msg = (role: 'user' | 'assistant' | 'tool', content: string) => ({
  id: newId(),
  role,
  content,
  toolCalls: null,
  toolCallId: null,
  toolName: null,
  pageContext: null,
  uiActions: [],
  runId: null,
});

/** The in-memory twin keeps the Drizzle repository's rules (the integration spec covers Postgres). */
describe('InMemoryAssistantRepository', () => {
  it('numbers messages, finds them without accents and tracks one running run per owner', async () => {
    const repo = new InMemoryAssistantRepository();
    const s = scope(newId());
    const t = await repo.createThread(s, {
      id: newId(),
      title: 'Ảnh',
      systemPrompt: 'p',
      promptVersion: 'assistant@1',
    });
    const added = await repo.appendMessages(s, t.id, [
      msg('user', 'Sản phẩm chưa có ảnh'),
      msg('assistant', 'Dạ'),
    ]);
    expect(added.map((m) => m.seq)).toEqual([1, 2]);
    expect((await repo.searchMessages(s, 'san pham', 3)).map((h) => h.messageId)).toEqual([
      added[0]!.id,
    ]);

    const first = run(t.id);
    expect(await repo.startRun(s, first)).toBe('started');
    expect(await repo.startRun(s, first)).toBe('duplicate');
    expect(await repo.startRun(s, run(t.id))).toBe('busy');
    await repo.addStep(s, {
      runId: first.id,
      idx: 0,
      kind: 'model_call',
      toolName: null,
      ok: true,
      ms: 5,
      errorCode: null,
    });
    await repo.finishRun(s, first.id, { status: 'done', rounds: 1 });
    expect(await repo.getRun(s, first.id)).toMatchObject({
      status: 'done',
      rounds: 1,
      steps: [{ idx: 0 }],
    });
    expect(await repo.startRun(s, run(t.id))).toBe('started');
  });

  it('treats another owner of the same account as a stranger', async () => {
    const repo = new InMemoryAssistantRepository();
    const a = scope(newId());
    const b = { ...scope(a.accountId) };
    const t = await repo.createThread(a, {
      id: newId(),
      title: '',
      systemPrompt: 'p',
      promptVersion: 'assistant@1',
    });
    expect(await repo.getThread(b, t.id)).toBeNull();
    expect(await repo.listThreads(b, { archived: false })).toEqual([]);
    await expect(repo.appendMessages(b, t.id, [msg('user', 'x')])).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
    await expect(repo.startRun(b, run(t.id))).rejects.toBeInstanceOf(AssistantNotFoundError);
  });

  it('matches thread text on user and assistant rows only, and trims the query', async () => {
    const repo = new InMemoryAssistantRepository();
    const s = scope(newId());
    const t = await repo.createThread(s, {
      id: newId(),
      title: 'Đơn',
      systemPrompt: 'p',
      promptVersion: 'assistant@1',
    });
    await repo.appendMessages(s, t.id, [msg('tool', '{"hits":["bí mật"]}')]);
    expect(await repo.listThreads(s, { archived: false, text: 'bi mat' })).toEqual([]);
    await repo.appendMessages(s, t.id, [msg('assistant', 'Dạ, bí mật ạ')]);
    expect(
      (await repo.listThreads(s, { archived: false, text: '  bi mat  ' })).map((x) => x.id),
    ).toEqual([t.id]);
    // Whitespace only is no filter.
    expect((await repo.listThreads(s, { archived: false, text: '   ' })).map((x) => x.id)).toEqual([
      t.id,
    ]);
  });

  it('refuses a run id another owner already used', async () => {
    const repo = new InMemoryAssistantRepository();
    const a = scope(newId());
    const b = scope(a.accountId);
    const ta = await repo.createThread(a, {
      id: newId(),
      title: '',
      systemPrompt: 'p',
      promptVersion: 'assistant@1',
    });
    const tb = await repo.createThread(b, {
      id: newId(),
      title: '',
      systemPrompt: 'p',
      promptVersion: 'assistant@1',
    });
    const first = run(ta.id);
    expect(await repo.startRun(a, first)).toBe('started');
    await expect(repo.startRun(b, { ...first, threadId: tb.id })).rejects.toBeInstanceOf(
      AssistantRunIdTakenError,
    );
  });
});
