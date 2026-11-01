import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LODGING_IDS, propertyFixture } from '@/testing/lodging-factories';
import { renderWithRouter } from '@/testing/render';

import { useProperty } from '../api/properties';
import { InfoTab } from './info-tab';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  toast.error.mockReset();
});

const path = `/lodging/properties/${LODGING_IDS.a17}`;
const conflict = (details: Record<string, unknown>) => ({
  status: 409,
  body: { error: { code: 'CONFLICT', message: 'conflict', details } },
});
type Reply = { status: number; body?: unknown };

/** Answers each "METHOD /path" with its replies in turn (the last one repeats). */
function stubSequence(routes: Record<string, Reply[]>) {
  const calls: Array<{ key: string; body: unknown }> = [];
  const seen: Record<string, number> = {};
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${input.replace('/api/v1', '').split('?')[0]}`;
    calls.push({ key, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const replies = routes[key];
    if (!replies) throw new Error(`unexpected request ${key}`);
    const i = Math.min(seen[key] ?? 0, replies.length - 1);
    seen[key] = i + 1;
    const reply = replies[i] as Reply;
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return calls;
}

function Harness() {
  const property = useProperty(LODGING_IDS.a17);
  return property.data ? (
    <InfoTab property={property.data} canEdit onDirtyChange={() => {}} />
  ) : null;
}

describe('InfoTab', () => {
  it('drops the edits after STALE_VERSION and saves the reloaded data next time', async () => {
    const theirs = propertyFixture({ name: 'Villa A17 (chủ đổi)', area: 'Hạ Long', version: 2 });
    const calls = stubSequence({
      [`GET ${path}`]: [
        { status: 200, body: propertyFixture() },
        { status: 200, body: theirs },
      ],
      [`PATCH ${path}`]: [
        conflict({ reason: 'STALE_VERSION', version: 2 }),
        { status: 200, body: { ...theirs, version: 3 } },
      ],
    });
    renderWithRouter(() => <Harness />);
    const name = await screen.findByLabelText('Tên căn hộ');
    await userEvent.clear(name);
    await userEvent.type(name, 'Tên của tôi');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Dữ liệu đã thay đổi, đã tải lại bản mới nhất.'),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Tên căn hộ')).toHaveValue('Villa A17 (chủ đổi)'),
    );
    expect(screen.getByLabelText('Khu vực')).toHaveValue('Hạ Long');

    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(calls.filter((c) => c.key === `PATCH ${path}`)).toHaveLength(2));
    const second = calls.filter((c) => c.key === `PATCH ${path}`)[1]?.body as {
      version: number;
      patch: { name: string; area: string };
    };
    expect(second.version).toBe(2);
    expect(second.patch).toMatchObject({ name: 'Villa A17 (chủ đổi)', area: 'Hạ Long' });
  });

  it('tells a taken code from a sell-mode refusal by the error details', async () => {
    stubSequence({
      [`GET ${path}`]: [{ status: 200, body: propertyFixture() }],
      [`PATCH ${path}`]: [conflict({}), conflict({ codes: ['BK-0007'] })],
    });
    renderWithRouter(() => <Harness />);
    await userEvent.type(await screen.findByLabelText('Mã căn hộ'), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Mã căn hộ đã có. Chọn mã khác.'));
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Không đổi được cách bán vì căn hộ còn booking BK-0007.',
      ),
    );
  });

  it('saves the internal note and says the bot never sees it', async () => {
    const calls = stubSequence({
      [`GET ${path}`]: [{ status: 200, body: propertyFixture() }],
      [`PATCH ${path}`]: [
        { status: 200, body: propertyFixture({ internalNote: 'Chìa khoá ở bảo vệ', version: 2 }) },
      ],
    });
    renderWithRouter(() => <Harness />);
    const note = await screen.findByLabelText('Ghi chú nội bộ — bot không thấy');
    await userEvent.type(note, 'Chìa khoá ở bảo vệ');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(calls.filter((c) => c.key === `PATCH ${path}`)).toHaveLength(1));
    const body = calls.find((c) => c.key === `PATCH ${path}`)?.body as {
      patch: { internalNote: string };
    };
    expect(body.patch.internalNote).toBe('Chìa khoá ở bảo vệ');
  });
});
