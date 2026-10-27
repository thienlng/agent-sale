import type { FanpageAction, FanpageComment } from '@agent-sales/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '@/testing/render';
import { clearAll } from '../../lib/comment-drafts';
import { CommentsWorkspace } from './comments-workspace';

vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('@/lib/session', () => ({
  useSession: () => ({ user: { id: 'u1' }, workspaceId: 'ws-1', memberships: [] }),
}));
const can = { edit: true };
vi.mock('@/lib/permissions', () => ({
  useCan: (capability: string) => (capability === 'contacts.edit' ? can.edit : false),
}));

const pageId = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01';
const base = `/channels/${pageId}/fanpage`;
const now = new Date().toISOString();
const page = (over: object = {}) => ({
  id: pageId,
  provider: 'facebook',
  externalId: '123',
  name: 'Shop Lan',
  status: 'connected',
  botId: null,
  expiresAt: null,
  createdAt: now,
  ...over,
});
const comment = (n: number, over: Partial<FanpageComment> = {}): FanpageComment => ({
  id: crypto.randomUUID(),
  connectionId: pageId,
  postId: '123_10',
  commentId: `10_${n}`,
  parentId: null,
  authorId: `9000000${n}`,
  text: `Áo này giá bao nhiêu ${n}`,
  occurredAt: now,
  version: `v${n}`,
  deleted: false,
  needsReview: false,
  context: null,
  actions: [],
  ...over,
});
const recorded = (id: string, kind: FanpageAction['kind'], status: FanpageAction['status']) => ({
  id,
  kind,
  status,
  text: kind.endsWith('reply') ? 'Dạ 250k ạ' : '',
  reason: 'Manual staff action',
  externalId: null,
  actorId: 'u1',
  recipientId: null,
  failureCode: null,
  createdAt: now,
});

type Handler = (url: URL, body: Record<string, unknown> | undefined) => unknown;
let records: FanpageComment[];
let channels: unknown[];
let calls: { method: string; url: URL; body: Record<string, unknown> | undefined }[];
let onAction: Handler;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  can.edit = true;
  records = [comment(1), comment(2, { text: '' })];
  channels = [page()];
  calls = [];
  onAction = (_url, body) => ({
    action: recorded(String(body?.requestId), 'public_reply', 'sent'),
  });
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, 'http://app.test');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/channels') return json({ data: channels, providers: [] });
    if (path === `${base}/comment-posts`)
      return json({
        data: [
          {
            postId: '123_10',
            comments: 2,
            lastActivityAt: now,
            text: 'Áo sơ mi xanh 250k',
            permalink: null,
          },
          { postId: '123_99', comments: 1, lastActivityAt: now, text: null, permalink: null },
        ],
      });
    if (path === `${base}/posts`)
      return json({ error: { code: 'UNAVAILABLE', message: 'x' } }, 503);
    if (path === `${base}/comments`) {
      const q = url.searchParams.get('q');
      const rows = records.filter((c) => !q || c.text.includes(q));
      const cursor = url.searchParams.get('cursor');
      const start = cursor ? Number(cursor) : 0;
      const limit = Number(url.searchParams.get('limit') ?? 100);
      return json({
        data: rows.slice(start, start + limit),
        nextCursor: start + limit < rows.length ? String(start + limit) : null,
      });
    }
    const detail = path.match(/\/comments\/([^/]+)$/);
    if (detail && method === 'GET') {
      const found = records.find((c) => c.commentId === decodeURIComponent(detail[1]!));
      return found
        ? json({ data: found, parent: null })
        : json({ error: { code: 'NOT_FOUND', message: 'x' } }, 404);
    }
    if (path.endsWith('/source'))
      return json({
        status: 'fresh',
        post: {
          id: '123_10',
          text: 'Áo sơ mi xanh 250k',
          permalink: 'https://www.facebook.com/shop/posts/10',
          media: [],
          fetchedAt: now,
        },
        parentText: '',
        commentText: records[0]!.text,
        matchesStored: true,
      });
    if (path.endsWith('/actions')) {
      const answer = await onAction(url, body);
      if (answer instanceof Response) return answer;
      if (answer instanceof Error) throw answer;
      return json(answer, 201);
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearAll();
});

const posts = () => calls.filter((c) => c.method === 'POST');
async function open(n: number) {
  const list = await screen.findByRole('list', { name: 'Bình luận Facebook' });
  await userEvent.click(within(list).getByRole('button', { name: new RegExp(`…00000${n}:`) }));
  return screen.findByRole('article', { name: 'Bình luận đang chọn' });
}

describe('Facebook comments in Inbox', () => {
  it('opens the only Page with stored comments, source post and honest scope labels', async () => {
    renderWithRouter(() => <CommentsWorkspace />);
    expect(await screen.findByText(/không phải toàn bộ lịch sử trên Facebook/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Trang')).not.toBeInTheDocument();
    expect(
      await screen.findByText('Không có chữ (ảnh, nhãn dán hoặc tệp đính kèm)'),
    ).toBeInTheDocument();
    // A post outside Facebook's latest-50 list is still offered, with a fallback label.
    expect(screen.getByRole('option', { name: 'Bài viết #99' })).toBeInTheDocument();
    const detail = await open(1);
    expect(await within(detail).findByText(/Vừa đọc từ Facebook/)).toBeInTheDocument();
    expect(within(detail).getByRole('region', { name: 'Bài viết gốc' })).toHaveTextContent(
      'Áo sơ mi xanh 250k',
    );
    expect(within(detail).getByRole('link', { name: /Mở trên Facebook/ })).toHaveAttribute(
      'href',
      'https://www.facebook.com/shop/posts/10',
    );
    expect(within(detail).getByText(/không phải mọi trả lời trên Facebook/)).toBeInTheDocument();
    // Viewing never posts anything.
    expect(posts()).toEqual([]);
  });

  it('loads older pages from the server and searches the stored set there', async () => {
    records = Array.from({ length: 35 }, (_, i) => comment(i + 1));
    renderWithRouter(() => <CommentsWorkspace />);
    const list = await screen.findByRole('list', { name: 'Bình luận Facebook' });
    expect(within(list).getAllByRole('button')).toHaveLength(30);
    await userEvent.click(screen.getByRole('button', { name: 'Tải thêm bình luận cũ hơn' }));
    await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(35));
    expect(calls.some((c) => c.url.searchParams.get('cursor') === '30')).toBe(true);
    expect(screen.getByText('Đã hiển thị hết bình luận đã nhận.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'không có');
    expect(await screen.findByText('Không có bình luận phù hợp')).toBeInTheDocument();
    expect(calls.some((c) => c.url.searchParams.get('q') === 'không có')).toBe(true);
  });

  it('says loading failed instead of claiming the Page has no comments', async () => {
    vi.stubGlobal('fetch', async (input: string) =>
      input.includes('/fanpage/comments')
        ? json({ error: { code: 'UNAVAILABLE', message: 'x' } }, 503)
        : input.endsWith('/channels')
          ? json({ data: channels, providers: [] })
          : json({ data: [] }),
    );
    renderWithRouter(() => <CommentsWorkspace />);
    expect(
      await screen.findByText(/Không tải được bình luận/, {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Chưa nhận được bình luận nào')).not.toBeInTheDocument();
  });

  it('keeps public and private drafts apart, per comment, and switching mode never sends', async () => {
    renderWithRouter(() => <CommentsWorkspace />);
    let detail = await open(1);
    await userEvent.type(within(detail).getByRole('textbox'), 'Công khai');
    await userEvent.click(within(detail).getByRole('button', { name: 'Nhắn riêng' }));
    expect(within(detail).getByRole('textbox')).toHaveValue('');
    expect(within(detail).getByText(/Gửi riêng vào Messenger/)).toBeInTheDocument();
    await userEvent.type(within(detail).getByRole('textbox'), 'Riêng tư');
    await userEvent.click(within(detail).getByRole('button', { name: 'Trả lời công khai' }));
    expect(within(detail).getByRole('textbox')).toHaveValue('Công khai');
    detail = await open(2);
    expect(within(detail).getByRole('textbox')).toHaveValue('');
    detail = await open(1);
    expect(within(detail).getByRole('textbox')).toHaveValue('Công khai');
    // Enter is a new line, not a send.
    await userEvent.type(within(detail).getByRole('textbox'), '{Enter}dòng 2');
    expect(within(detail).getByRole('textbox')).toHaveValue('Công khai\ndòng 2');
    expect(posts()).toEqual([]);
  });

  it('asks before posting contact details publicly, then sends with the version and clears', async () => {
    renderWithRouter(() => <CommentsWorkspace />);
    const detail = await open(1);
    await userEvent.type(within(detail).getByRole('textbox'), 'Gọi 0912 345 678 nhé');
    await userEvent.click(within(detail).getByRole('button', { name: 'Gửi công khai' }));
    expect(within(detail).getByText(/có số điện thoại hoặc email/)).toBeInTheDocument();
    expect(posts()).toEqual([]);
    await userEvent.click(within(detail).getByRole('button', { name: 'Vẫn đăng công khai' }));
    await waitFor(() => expect(within(detail).getByRole('textbox')).toHaveValue(''));
    expect(posts()[0]?.body).toMatchObject({
      kind: 'public_reply',
      text: 'Gọi 0912 345 678 nhé',
      version: 'v1',
      confirmPublicContact: true,
      requestId: expect.any(String),
    });
    expect(within(detail).getByText('Đã đăng trả lời công khai.')).toBeInTheDocument();
  });

  it('retries a timed-out send with the same request id and keeps the text locked meanwhile', async () => {
    onAction = () => new TypeError('network');
    renderWithRouter(() => <CommentsWorkspace />);
    const detail = await open(1);
    const box = within(detail).getByRole('textbox');
    await userEvent.type(box, 'Dạ 250k ạ');
    await userEvent.click(within(detail).getByRole('button', { name: 'Gửi công khai' }));
    expect(await within(detail).findByText(/gửi lại sẽ dùng đúng yêu cầu cũ/)).toBeInTheDocument();
    expect(box).toHaveAttribute('readonly');
    onAction = (_url, body) => ({
      action: recorded(String(body?.requestId), 'public_reply', 'sent'),
    });
    await userEvent.click(within(detail).getByRole('button', { name: 'Gửi lại yêu cầu này' }));
    await waitFor(() => expect(box).toHaveValue(''));
    const [first, second] = posts();
    expect(second?.body?.requestId).toBe(first?.body?.requestId);
  });

  it('treats an answer without an action as not sent until the record shows it', async () => {
    onAction = () => ({ action: null });
    renderWithRouter(() => <CommentsWorkspace />);
    const detail = await open(1);
    await userEvent.type(within(detail).getByRole('textbox'), 'Dạ 250k ạ');
    await userEvent.click(within(detail).getByRole('button', { name: 'Gửi công khai' }));
    expect(await within(detail).findByText(/Không có tin nào được ghi nhận/)).toBeInTheDocument();
    expect(within(detail).getByRole('textbox')).toHaveValue('Dạ 250k ạ');
  });

  it('asks before sending a new public reply after an unknown outcome', async () => {
    onAction = (_url, body) => ({
      action: recorded(String(body?.requestId), 'public_reply', 'unknown'),
    });
    renderWithRouter(() => <CommentsWorkspace />);
    const detail = await open(1);
    await userEvent.type(within(detail).getByRole('textbox'), 'Dạ 250k ạ');
    await userEvent.click(within(detail).getByRole('button', { name: 'Gửi công khai' }));
    await userEvent.click(
      await within(detail).findByRole('button', { name: 'Đã kiểm tra, gửi lần mới' }),
    );
    expect(within(detail).getByText(/có thể tạo một trả lời trùng/)).toBeInTheDocument();
    expect(posts()).toHaveLength(1);
    await userEvent.click(within(detail).getByRole('button', { name: 'Vẫn gửi lần mới' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1]?.body?.requestId).not.toBe(posts()[0]?.body?.requestId);
  });

  it('explains why a private message is unavailable instead of offering it', async () => {
    records = [
      comment(1, { actions: [recorded(crypto.randomUUID(), 'private_reply', 'unknown')] }),
    ];
    renderWithRouter(() => <CommentsWorkspace />);
    const detail = await open(1);
    await userEvent.click(within(detail).getByRole('button', { name: 'Nhắn riêng' }));
    expect(within(detail).getByText(/đã được nhắn riêng một lần/)).toBeInTheDocument();
    expect(within(detail).queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      within(detail).getByText(/kiểm tra trên Facebook trước khi gửi lại/),
    ).toBeInTheDocument();
  });

  it('never shows an uncertain hide as hidden', async () => {
    onAction = (_url, body) => ({ action: recorded(String(body?.requestId), 'hide', 'unknown') });
    renderWithRouter(() => <CommentsWorkspace />);
    const detail = await open(1);
    await userEvent.click(within(detail).getByRole('button', { name: 'Ẩn' }));
    expect(
      await within(detail).findByText(/Chưa rõ Facebook đã ẩn\/hiện chưa/),
    ).toBeInTheDocument();
    expect(within(detail).queryByText('Đang ẩn')).not.toBeInTheDocument();
    expect(posts()[0]?.body).toMatchObject({ kind: 'hide', version: 'v1' });
  });

  it('is view-only for roles without the inbox write capability', async () => {
    can.edit = false;
    renderWithRouter(() => <CommentsWorkspace />);
    const detail = await open(1);
    expect(within(detail).getByText(/chỉ được xem/)).toBeInTheDocument();
    expect(within(detail).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(detail).getByRole('button', { name: 'Ẩn' })).toBeDisabled();
  });

  it('asks for a Page when several exist and keeps comments readable when one needs reconnecting', async () => {
    channels = [
      page({ status: 'reauth_required' }),
      page({ id: crypto.randomUUID(), name: 'Shop Hai' }),
    ];
    renderWithRouter(() => <CommentsWorkspace />);
    expect(await screen.findByText('Chọn một Trang để xem bình luận')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Trang'), pageId);
    expect(await screen.findByText(/Shop Lan cần kết nối lại/)).toBeInTheDocument();
    const detail = await open(1);
    expect(within(detail).getByText('Kết nối lại Trang để trả lời.')).toBeInTheDocument();
  });

  it('settles a send that resolves after moving to another comment only on its own draft', async () => {
    let resolve: (r: Response) => void = () => {};
    onAction = () => new Promise<Response>((r) => (resolve = r));
    renderWithRouter(() => <CommentsWorkspace />);
    let detail = await open(1);
    await userEvent.type(within(detail).getByRole('textbox'), 'Cho comment 1');
    await userEvent.click(within(detail).getByRole('button', { name: 'Gửi công khai' }));
    detail = await open(2);
    await userEvent.type(within(detail).getByRole('textbox'), 'Nháp comment 2');
    const id = String(posts()[0]?.body?.requestId);
    await act(async () => resolve(json({ action: recorded(id, 'public_reply', 'sent') }, 201)));
    expect(within(detail).getByRole('textbox')).toHaveValue('Nháp comment 2');
    expect(within(detail).queryByText('Đã đăng trả lời công khai.')).not.toBeInTheDocument();
    detail = await open(1);
    expect(within(detail).getByRole('textbox')).toHaveValue('');
  });
});
