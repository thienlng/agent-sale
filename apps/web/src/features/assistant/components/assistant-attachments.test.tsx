import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import type * as ResizeModule from '@/lib/resize-image';
import type { Session } from '@/lib/session';
import {
  ASSISTANT_IDS,
  importBatchFixture,
  threadFixture,
  turnFixture,
} from '@/testing/assistant-factories';
import { renderWithRouter, stubFetch } from '@/testing/render';

import { useAssistantUi } from '../stores/assistant-ui.store';
import { AssistantPanel } from './assistant-panel';

const ACCOUNT = '0b9c3a52-5e3f-4c55-9a51-6a0f4b7d2c01';
const WS = '3f0c1f0e-5b1c-4c1e-9d55-0a1b2c3d4e5f';
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => WS }));
vi.mock('@/lib/session', () => ({
  useSession: (): Session => ({
    user: { id: 'u1' } as Session['user'],
    accounts: [{ accountId: ACCOUNT, name: 'Shop An', role: 'owner' }],
    memberships: [
      {
        workspaceId: WS,
        workspaceName: 'Shop An',
        role: 'owner',
        industry: 'retail',
        accountId: ACCOUNT,
        accountName: 'Shop An',
      },
    ],
    workspaceId: WS,
  }),
}));
vi.mock('@/lib/resize-image', async (orig) => ({
  ...(await orig<typeof ResizeModule>()),
  resizeImage: vi.fn(() => Promise.resolve({ mimeType: 'image/jpeg', base64: 'QkFTRQ==' })),
  thumbnail: vi.fn(() => Promise.resolve({ mimeType: 'image/jpeg', base64: 'VEhVTUI=' })),
}));

const MESSAGES = `POST /assistant/threads/${ASSISTANT_IDS.thread}/messages`;
const IMPORTS = `POST /assistant/threads/${ASSISTANT_IDS.thread}/imports`;
const photoUrl = (n: number) => `/media/products/${WS}/0193b000-0000-7000-8000-00000000060${n}.jpg`;

beforeAll(() => loadNamespace('assistant'));
beforeEach(() => {
  useAssistantUi.setState({ open: true, workspaceId: WS, threadId: null, spotlight: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
  toast.mockClear();
  toast.error.mockClear();
});

/** Every request the panel makes in these tests; uploads answer one photo path after another. */
function stub(extra: Record<string, { status: number; body?: unknown }> = {}) {
  const stubbed = stubFetch({
    'POST /assistant/threads': { status: 201, body: threadFixture() },
    [IMPORTS]: { status: 201, body: importBatchFixture() },
    [MESSAGES]: { status: 200, body: turnFixture('Nhập sản phẩm từ tệp hang.csv') },
    'GET /assistant/threads': { status: 200, body: { data: [threadFixture()] } },
    [`GET /assistant/threads/${ASSISTANT_IDS.thread}/proposals`]: {
      status: 200,
      body: { items: [] },
    },
    ...extra,
  });
  let uploads = 0;
  const fetchStub = (input: string, init: RequestInit = {}) => {
    if (input.endsWith('/products/images')) {
      stubbed.calls.push({
        key: 'POST /products/images',
        body: JSON.parse(String(init.body)),
        headers: (init.headers ?? {}) as Record<string, string>,
      });
      uploads++;
      return Promise.resolve(
        new Response(JSON.stringify({ url: photoUrl(uploads) }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (input.includes('/assistant/runs/')) {
      return Promise.resolve(new Response(null, { status: 404 }));
    }
    return stubbed.fetchStub(input, init);
  };
  vi.stubGlobal('fetch', fetchStub);
  return stubbed.calls;
}

const jpg = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

// Each test drives the whole panel; a busy machine needs more than the default 5 s.
describe('assistant attachments', { timeout: 20_000 }, () => {
  it('reads a sheet, creates the batch and sends the message with its id', async () => {
    const calls = stub();
    const user = userEvent.setup();
    renderWithRouter(() => <AssistantPanel />);
    const csv = new File(['Tên;Giá\nÁo;150k\n'], 'hang.csv', { type: 'text/csv' });
    await user.upload(await screen.findByTestId('assistant-file-input'), csv);
    expect(await screen.findByText('2 dòng')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Gửi' }));
    await waitFor(() => expect(calls.some((c) => c.key === MESSAGES)).toBe(true));
    expect(calls.find((c) => c.key === IMPORTS)?.body).toEqual({
      kind: 'sheet',
      businessId: WS,
      fileName: 'hang.csv',
      rows: [
        ['Tên', 'Giá'],
        ['Áo', '150k'],
      ],
    });
    expect(calls.find((c) => c.key === MESSAGES)?.body).toMatchObject({
      text: 'Nhập sản phẩm từ tệp hang.csv',
      importBatchId: ASSISTANT_IDS.batch,
    });
    await waitFor(() => expect(screen.queryByText('hang.csv')).not.toBeInTheDocument());
  });

  it('uploads photos first, then creates the photo batch with their thumbnails', async () => {
    const calls = stub();
    const user = userEvent.setup();
    renderWithRouter(() => <AssistantPanel />);
    await user.upload(await screen.findByTestId('assistant-file-input'), [
      jpg('a.jpg'),
      jpg('b.jpg'),
    ]);
    await waitFor(() =>
      expect(calls.filter((c) => c.key === 'POST /products/images')).toHaveLength(2),
    );
    const upload = calls.find((c) => c.key === 'POST /products/images');
    expect(upload?.body).toEqual({ mimeType: 'image/jpeg', base64: 'QkFTRQ==' });
    expect(upload?.headers['X-Workspace-Id']).toBe(WS);

    await user.type(screen.getByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' }), 'Giá 200k cả hai');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Gửi' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Gửi' }));
    await waitFor(() => expect(calls.some((c) => c.key === MESSAGES)).toBe(true));
    expect(calls.find((c) => c.key === IMPORTS)?.body).toEqual({
      kind: 'photos',
      businessId: WS,
      grouping: 'per_photo',
      items: [
        { imageUrl: photoUrl(1), mimeType: 'image/jpeg', base64: 'VEhVTUI=' },
        { imageUrl: photoUrl(2), mimeType: 'image/jpeg', base64: 'VEhVTUI=' },
      ],
    });
    expect(calls.find((c) => c.key === MESSAGES)?.body).toMatchObject({
      text: 'Giá 200k cả hai',
      importBatchId: ASSISTANT_IDS.batch,
    });
  });

  it('refuses one product of 6 photos and keeps the text', async () => {
    const calls = stub();
    const user = userEvent.setup();
    renderWithRouter(() => <AssistantPanel />);
    await user.upload(
      await screen.findByTestId('assistant-file-input'),
      Array.from({ length: 6 }, (_, i) => jpg(`p${i}.jpg`)),
    );
    await waitFor(() =>
      expect(calls.filter((c) => c.key === 'POST /products/images')).toHaveLength(6),
    );
    await user.click(screen.getByRole('radio', { name: 'Tất cả là một sản phẩm' }));
    const box = screen.getByRole('textbox', { name: 'Hỏi Thỏ Rapiz…' });
    await user.type(box, 'Một bộ váy');
    await user.click(screen.getByRole('button', { name: 'Gửi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('tối đa 5 ảnh');
    expect(calls.some((c) => c.key === IMPORTS)).toBe(false);
    expect(box).toHaveValue('Một bộ váy');
  });

  it('refuses HEIC photos and legacy .xls files with a hint', async () => {
    stub();
    const user = userEvent.setup({ applyAccept: false });
    renderWithRouter(() => <AssistantPanel />);
    const input = await screen.findByTestId('assistant-file-input');
    await user.upload(input, new File(['x'], 'IMG_1.HEIC', { type: 'image/heic' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HEIC');

    const xls = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])], 'cu.xls');
    await user.upload(input, xls);
    expect(await screen.findByRole('alert')).toHaveTextContent('Lưu thành .xlsx');
  });

  it('removes an attachment from the tray', async () => {
    stub();
    const user = userEvent.setup();
    renderWithRouter(() => <AssistantPanel />);
    const csv = new File(['Tên,Giá\nÁo,1\n'], 'hang.csv', { type: 'text/csv' });
    await user.upload(await screen.findByTestId('assistant-file-input'), csv);
    await user.click(await screen.findByRole('button', { name: 'Bỏ hang.csv' }));
    expect(screen.queryByText('hang.csv')).not.toBeInTheDocument();
  });
});
