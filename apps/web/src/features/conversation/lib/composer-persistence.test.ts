import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.resetModules();
});

async function store() {
  return import('./composer-draft');
}

describe('persistent inbox text drafts', () => {
  it('restores only text and text retry metadata after a page reload', async () => {
    const first = await store();
    const key = first.draftKey('user', 'business', 'conversation', 'page');
    const attempt = { text: 'Hello', idempotencyKey: crypto.randomUUID() };
    first.writeDraft(key, {
      text: 'Hello',
      attempt,
      attachment: { type: 'image', url: 'https://example.test/private.png' },
      attachmentAttempt: {
        text: '',
        attachment: { type: 'image', url: 'https://example.test/private.png' },
        idempotencyKey: crypto.randomUUID(),
      },
    });
    vi.resetModules();
    const reloaded = await store();
    expect(reloaded.readDraft(key)).toMatchObject({ text: 'Hello', attempt, attachment: null });
    expect(reloaded.readDraft(key).attachmentAttempt).toBeUndefined();
    expect(JSON.stringify(localStorage)).not.toContain('private.png');
    for (const other of [
      reloaded.draftKey('other', 'business', 'conversation', 'page'),
      reloaded.draftKey('user', 'other', 'conversation', 'page'),
      reloaded.draftKey('user', 'business', 'other', 'page'),
      reloaded.draftKey('user', 'business', 'conversation', 'other'),
    ])
      expect(reloaded.readDraft(other).text).toBe('');
  });

  it('removes a sent or explicitly emptied draft from persistent storage', async () => {
    const first = await store();
    const key = first.draftKey('user', 'business', 'conversation');
    first.writeDraft(key, { text: 'Hello', attempt: null, attachment: null });
    first.writeDraft(key, { text: '', attempt: null, attachment: null });
    vi.resetModules();
    expect((await store()).readDraft(key).text).toBe('');
  });

  it('clears private drafts on logout and invalidates callbacks from the previous session', async () => {
    const drafts = await store();
    const lifecycle = await import('@/lib/private-browser-state');
    const key = drafts.draftKey('user', 'business', 'conversation');
    const version = lifecycle.privateStateVersion();
    drafts.writeDraft(key, { text: 'Unsent', attempt: null, attachment: null }, version);
    lifecycle.clearPrivateBrowserState();
    drafts.writeDraft(
      key,
      { text: 'Old request finished', attempt: null, attachment: null },
      version,
    );
    expect(drafts.readDraft(key).text).toBe('');
    expect(Object.keys(localStorage).filter((key) => key.startsWith('rapiz.private.'))).toEqual([]);
  });

  it('keeps editing in memory and reports when browser persistence is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    const drafts = await store();
    const key = drafts.draftKey('user', 'business', 'conversation');
    expect(() =>
      drafts.writeDraft(key, { text: 'Keep editing', attempt: null, attachment: null }),
    ).not.toThrow();
    expect(drafts.readDraft(key).text).toBe('Keep editing');
    expect(drafts.draftStorageUnavailable(key)).toBe(true);
  });

  it('expires stored text after seven days and ignores corrupt or oversized records', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const drafts = await store();
    const key = drafts.draftKey('user', 'business', 'conversation');
    drafts.writeDraft(key, { text: 'Old draft', attempt: null, attachment: null });
    vi.mocked(Date.now).mockReturnValue(1_000_000 + 7 * 86400000 + 1);
    vi.resetModules();
    expect((await store()).readDraft(key).text).toBe('');
    const prefix = 'rapiz.private.inbox.draft.v1:';
    localStorage.setItem(prefix + key, '{broken');
    vi.resetModules();
    expect((await store()).readDraft(key).text).toBe('');
    localStorage.setItem(
      prefix + key,
      JSON.stringify({ version: 1, savedAt: Date.now(), text: 'x'.repeat(2001), attempt: null }),
    );
    vi.resetModules();
    expect((await store()).readDraft(key).text).toBe('');
  });

  it('bounds persisted drafts without deleting unrelated browser settings', async () => {
    const drafts = await store();
    localStorage.setItem('rapiz.locale', 'vi');
    for (let i = 0; i < 105; i++) {
      drafts.writeDraft(drafts.draftKey('user', 'business', String(i)), {
        text: 'Draft',
        attempt: null,
        attachment: null,
      });
    }
    const keys = Object.keys(localStorage).filter((key) =>
      key.startsWith('rapiz.private.inbox.draft.v1:'),
    );
    expect(keys.length).toBeLessThanOrEqual(100);
    vi.resetModules();
    const reloaded = await store();
    expect(reloaded.readDraft(reloaded.draftKey('user', 'business', '104')).text).toBe('Draft');
    expect(localStorage.getItem('rapiz.locale')).toBe('vi');
  });
});

describe('draft concurrency and cleanup', () => {
  it('does not rehydrate private text when deletion fails, including after module reload', async () => {
    const drafts = await store();
    const key = drafts.draftKey('user', 'business', 'conversation');
    drafts.writeDraft(key, { text: 'Private text', attachment: null, attempt: null });
    const { clearPrivateBrowserState } = await import('@/lib/private-browser-state');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Blocked');
    });
    clearPrivateBrowserState();
    expect(drafts.readDraft(key).text).toBe('');
    vi.resetModules();
    expect((await store()).readDraft(key).text).toBe('');
  });

  it('refuses a stale send and does not delete another tab draft on completion', async () => {
    const drafts = await store();
    const persistence = await import('./composer-persistence');
    const { privateStateVersion } = await import('@/lib/private-browser-state');
    const key = drafts.draftKey('user', 'business', 'conversation');
    drafts.writeDraft(key, { text: 'Old', attachment: null, attempt: null });
    const storageKey = persistence.DRAFT_STORAGE_PREFIX + key;
    const remote = {
      ...JSON.parse(localStorage.getItem(storageKey)!),
      text: 'New from other tab',
      requestKey: crypto.randomUUID(),
      attempt: null,
    };
    localStorage.setItem(storageKey, JSON.stringify(remote));
    expect(drafts.canSendDraft(key, privateStateVersion())).toBe(false);
    drafts.writeDraft(key, { text: '', attachment: null, attempt: null });
    expect(JSON.parse(localStorage.getItem(storageKey)!).text).toBe('New from other tab');
    drafts.resolveDraftConflict(key, false, privateStateVersion());
    expect(drafts.readDraft(key).text).toBe('New from other tab');
  });

  it('preserves the shared send identity across reload before an attempt is made', async () => {
    const drafts = await store();
    const key = drafts.draftKey('user', 'business', 'conversation');
    drafts.writeDraft(key, { text: 'Same draft', attachment: null, attempt: null });
    const requestKey = drafts.draftRequestKey(key);
    vi.resetModules();
    expect((await store()).draftRequestKey(key)).toBe(requestKey);
  });
});

it('still removes private text at logout when generation writes fail because storage is full', async () => {
  const drafts = await store();
  const key = drafts.draftKey('user', 'business', 'conversation');
  drafts.writeDraft(key, { text: 'Private draft', attachment: null, attempt: null });
  const { clearPrivateBrowserState } = await import('@/lib/private-browser-state');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Quota full');
  });
  clearPrivateBrowserState();
  vi.resetModules();
  expect((await store()).readDraft(key).text).toBe('');
});

it('retains a staged image when another tab changes the text draft', async () => {
  const drafts = await store();
  const persistence = await import('./composer-persistence');
  const key = drafts.draftKey('user', 'business', 'staged-image-conversation');
  const attachment = { type: 'image' as const, url: 'https://example.test/staged.png' };
  drafts.writeDraft(key, { text: '', attachment, attempt: null });
  persistence.persistTextDraft(key, { text: 'Other tab', attempt: null });
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: persistence.DRAFT_STORAGE_PREFIX + key,
      newValue: localStorage.getItem(persistence.DRAFT_STORAGE_PREFIX + key),
    }),
  );
  expect(drafts.readDraft(key)).toMatchObject({ attachment, conflict: true });
});

it('accepts a fresh-generation replacement instead of deleting a tombstoned key', async () => {
  const drafts = await store();
  const { DRAFT_STORAGE_PREFIX } = await import('./composer-persistence');
  const { clearPrivateBrowserState, privateCacheGeneration } =
    await import('@/lib/private-browser-state');
  const key = drafts.draftKey('user', 'business', 'replacement-conversation');
  drafts.writeDraft(key, { text: 'Old private draft', attachment: null, attempt: null });
  const storageKey = DRAFT_STORAGE_PREFIX + key;
  const old = JSON.parse(localStorage.getItem(storageKey)!);
  clearPrivateBrowserState();
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      ...old,
      generation: privateCacheGeneration(),
      text: 'New session draft',
      requestKey: crypto.randomUUID(),
    }),
  );
  expect(drafts.readDraft(key).text).toBe('New session draft');
  expect(localStorage.getItem(storageKey)).toContain('New session draft');
});

it('keeps new-session editing usable when generation writes are blocked, then recovers persistence', async () => {
  const drafts = await store();
  const lifecycle = await import('@/lib/private-browser-state');
  const key = drafts.draftKey('user', 'business', 'recovery-conversation');
  drafts.writeDraft(key, { text: 'Old text', attachment: null, attempt: null });
  const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  lifecycle.clearPrivateBrowserState();
  drafts.writeDraft(
    key,
    { text: 'New session text', attachment: null, attempt: null },
    lifecycle.privateStateVersion(),
  );
  expect(drafts.readDraft(key).text).toBe('New session text');
  expect(drafts.draftStorageUnavailable(key)).toBe(true);
  blocked.mockRestore();
  drafts.writeDraft(
    key,
    { text: 'Recovered text', attachment: null, attempt: null },
    lifecycle.privateStateVersion(),
  );
  vi.resetModules();
  expect((await store()).readDraft(key).text).toBe('Recovered text');
});

it('does not publish an expiry event when saving the first draft in fresh browser storage', async () => {
  const drafts = await store();
  drafts.writeDraft(drafts.draftKey('user', 'business', 'fresh-initial'), {
    text: 'First draft',
    attachment: null,
    attempt: null,
  });
  expect(localStorage.getItem('rapiz.private-generation')).toBeNull();
});
