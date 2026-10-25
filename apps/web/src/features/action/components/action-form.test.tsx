import type { ActionDto } from '@agent-sales/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, stubFetch } from '@/testing/render';

import { ActionFormView } from './action-form';
import { actionDto, BOT_ID } from './fixtures';

// Form interactions are many and the suite runs in parallel with the whole web package.
vi.setConfig({ testTimeout: 20_000 });
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  // jsdom lacks these; Radix Select needs them to open.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

const save = () => screen.getByRole('button', { name: 'Lưu' });

/** The in-memory router mounts asynchronously, so wait for the form before interacting. */
async function renderForm(action?: ActionDto) {
  renderWithRouter(() => <ActionFormView botId={BOT_ID} {...(action ? { action } : {})} />);
  await screen.findByLabelText('Tên hành động');
}

async function fillBasics() {
  await userEvent.click(screen.getByLabelText('Tên hành động'));
  await userEvent.paste('Tra cứu đơn');
  await userEvent.click(screen.getByLabelText('Mô tả'));
  await userEvent.paste('Khi khách hỏi đơn');
  await userEvent.click(screen.getByLabelText('Đường dẫn API'));
  await userEvent.paste('https://shop.vn/orders');
}

describe('ActionFormView', () => {
  it('tries the unsaved form: invalid shows errors without a call, valid sends the draft', async () => {
    const { fetchStub, calls } = stubFetch({
      [`POST /bots/${BOT_ID}/actions/test`]: {
        status: 200,
        body: { ok: true, statusCode: 200, data: { total: 2 }, errorCode: null, latencyMs: 5 },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    await renderForm();
    const tryIt = () => screen.getAllByRole('button', { name: 'Thử gọi' }).at(-1)!;
    await userEvent.click(tryIt());
    expect((await screen.findAllByText('Bắt buộc')).length).toBeGreaterThanOrEqual(2);
    expect(calls).toHaveLength(0);
    await fillBasics();
    await userEvent.click(tryIt());
    expect(await screen.findByText('Thành công')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      action: { name: 'Tra cứu đơn', url: 'https://shop.vn/orders' },
      args: {},
    });
    expect(calls[0]?.body).not.toHaveProperty('actionId');
  });

  it('shows required-field errors and does not call the API', async () => {
    const { fetchStub, calls } = stubFetch({});
    vi.stubGlobal('fetch', fetchStub);
    await renderForm();
    await userEvent.click(save());
    expect((await screen.findAllByText('Bắt buộc')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Cần một đường dẫn HTTPS hợp lệ')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('requires a path param for each {placeholder}', async () => {
    vi.stubGlobal('fetch', stubFetch({}).fetchStub);
    await renderForm();
    await fillBasics();
    await userEvent.click(screen.getByLabelText('Đường dẫn API'));
    await userEvent.keyboard('/{{id}');
    await userEvent.click(save());
    expect(
      await screen.findByText('{id} cần một tham số vị trí Đường dẫn cùng tên'),
    ).toBeInTheDocument();
  });

  it('rejects duplicate parameter names', async () => {
    vi.stubGlobal('fetch', stubFetch({}).fetchStub);
    await renderForm();
    await fillBasics();
    for (let i = 0; i < 2; i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Thêm tham số' }));
      await userEvent.click(screen.getByLabelText(`Tên ${i + 1}`));
      await userEvent.paste('q');
      await userEvent.click(screen.getByLabelText(`Mô tả ${i + 1}`));
      await userEvent.paste('tìm');
    }
    await userEvent.click(save());
    expect(await screen.findByText('Tên tham số bị trùng')).toBeInTheDocument();
  });

  it('adds and removes parameter, response and field rows', async () => {
    vi.stubGlobal('fetch', stubFetch({}).fetchStub);
    await renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Thêm tham số' }));
    await userEvent.click(screen.getByRole('button', { name: 'Thêm tham số' }));
    expect(screen.getAllByRole('textbox', { name: /^Tên \d$/ })).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Xóa tham số 1' }));
    expect(screen.getAllByRole('textbox', { name: /^Tên \d$/ })).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Thêm phản hồi' }));
    expect(screen.getByLabelText('Mã trạng thái 1')).toHaveValue('200');
    await userEvent.click(screen.getByRole('button', { name: 'Thêm trường 1' }));
    expect(screen.getByLabelText('Tên trường 1.1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Xóa trường 1.1' }));
    expect(screen.queryByLabelText('Tên trường 1.1')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Xóa phản hồi 1' }));
    expect(screen.queryByLabelText('Mã trạng thái 1')).not.toBeInTheDocument();
  });

  it('defaults "yêu cầu khách xác nhận" on for non-GET until the owner changes it', async () => {
    vi.stubGlobal('fetch', stubFetch({}).fetchStub);
    await renderForm();
    const confirm = screen.getByRole('switch', { name: 'Yêu cầu khách xác nhận' });
    expect(confirm).not.toBeChecked();
    await userEvent.click(screen.getByRole('combobox', { name: 'Phương thức' }));
    await userEvent.click(await screen.findByRole('option', { name: 'POST' }));
    expect(confirm).toBeChecked();
    await userEvent.click(confirm);
    await userEvent.click(screen.getByRole('combobox', { name: 'Phương thức' }));
    await userEvent.click(await screen.findByRole('option', { name: 'PUT' }));
    expect(confirm).not.toBeChecked();
  });

  it('creates the action with a POST of the validated body', async () => {
    const { fetchStub, calls } = stubFetch({
      [`POST /bots/${BOT_ID}/actions`]: { status: 201, body: actionDto() },
    });
    vi.stubGlobal('fetch', fetchStub);
    await renderForm();
    await fillBasics();
    await userEvent.click(save());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toMatchObject({
      name: 'Tra cứu đơn',
      description: 'Khi khách hỏi đơn',
      url: 'https://shop.vn/orders',
      method: 'GET',
      auth: { kind: 'none' },
      params: [],
      responses: [],
      requiresConfirm: false,
      enabled: true,
    });
  });

  describe('secret is write-only', () => {
    const stored = actionDto();
    const patch = `PATCH /bots/${BOT_ID}/actions/${stored.id}`;

    it('shows "•••• đã lưu" instead of the value and keeps it when left empty', async () => {
      const { fetchStub, calls } = stubFetch({ [patch]: { status: 200, body: stored } });
      vi.stubGlobal('fetch', fetchStub);
      await renderForm(stored);
      const secret = screen.getByLabelText('Khóa bí mật');
      expect(secret).toHaveValue('');
      expect(secret).toHaveAttribute('placeholder', '•••• đã lưu');
      await userEvent.click(save());
      await waitFor(() => expect(calls).toHaveLength(1));
      expect('authSecret' in (calls[0]?.body as object)).toBe(false);
    });

    it('sends a new secret only when typed', async () => {
      const { fetchStub, calls } = stubFetch({ [patch]: { status: 200, body: stored } });
      vi.stubGlobal('fetch', fetchStub);
      await renderForm(stored);
      await userEvent.type(screen.getByLabelText('Khóa bí mật'), 'new-token');
      await userEvent.click(save());
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]?.body).toMatchObject({ authSecret: 'new-token' });
    });

    it('keeps the form pre-filled from the stored action and hides the secret for "none"', async () => {
      vi.stubGlobal('fetch', stubFetch({}).fetchStub);
      await renderForm(stored);
      expect(screen.getByLabelText('Tên hành động')).toHaveValue('Tra cứu đơn hàng');
      expect(screen.getByLabelText('Tên 1')).toHaveValue('orderId');
      await userEvent.click(screen.getByRole('combobox', { name: 'Xác thực' }));
      await userEvent.click(await screen.findByRole('option', { name: 'Không xác thực' }));
      expect(screen.queryByLabelText('Khóa bí mật')).not.toBeInTheDocument();
      expect(within(document.body).queryByDisplayValue('•••• đã lưu')).not.toBeInTheDocument();
    });
  });
});
