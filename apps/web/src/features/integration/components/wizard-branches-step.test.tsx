import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithProviders, stubFetch } from '@/testing/render';

import { BRANCHES, TEST_RESPONSE } from './fixtures';
import { KiotVietWizard } from './kiotviet-wizard';

beforeAll(() => loadNamespace('integration'));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => vi.unstubAllGlobals());
beforeAll(() => {
  // Radix Select uses pointer capture, which jsdom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
});

async function toBranches(body = TEST_RESPONSE) {
  const { fetchStub } = stubFetch({ 'POST /integrations/kiotviet/test': { status: 200, body } });
  vi.stubGlobal('fetch', fetchStub);
  renderWithProviders(<KiotVietWizard />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Tên gian hàng'), 'shopabc');
  await user.type(screen.getByLabelText('Client ID'), 'client-1');
  await user.type(screen.getByLabelText('Mã bảo mật'), 'secret-1');
  await user.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
  await screen.findByText('Bước 2/3');
  return user;
}

describe('wizard branches step', () => {
  it('lists branches with addresses, none ticked when there are several', async () => {
    await toBranches();
    expect(screen.getByText('Chi nhánh dùng để bán online')).toBeInTheDocument();
    expect(screen.getByText('12 Trần Thái Tông, Hà Nội')).toBeInTheDocument();
    for (const b of BRANCHES)
      expect(screen.getByRole('checkbox', { name: b.name })).not.toBeChecked();
  });

  it('ticks the only branch and makes it the order branch', async () => {
    const user = await toBranches({ ...TEST_RESPONSE, branches: [BRANCHES[0]!] });
    expect(screen.getByRole('checkbox', { name: BRANCHES[0]!.name })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    expect(await screen.findByText('Bước 3/3')).toBeInTheDocument();
  });

  it('requires at least one branch and focuses the list', async () => {
    const user = await toBranches();
    await user.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    expect(screen.getByText('Chọn ít nhất một chi nhánh.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: BRANCHES[0]!.name })).toHaveFocus(),
    );
    expect(screen.getByText('Bước 2/3')).toBeInTheDocument();
  });

  it('requires the order branch among the ticked ones', async () => {
    const user = await toBranches();
    await user.click(screen.getByRole('checkbox', { name: BRANCHES[0]!.name }));
    await user.click(screen.getByRole('checkbox', { name: BRANCHES[1]!.name }));
    // The first ticked branch became the order branch; unticking it clears the choice.
    await user.click(screen.getByRole('checkbox', { name: BRANCHES[0]!.name }));
    await user.click(screen.getByRole('checkbox', { name: BRANCHES[0]!.name }));
    const order = screen.getByRole('combobox', { name: 'Chi nhánh nhận đơn' });
    expect(order).toHaveTextContent(BRANCHES[1]!.name);
    await user.click(order);
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([BRANCHES[0]!.name, BRANCHES[1]!.name]);
    await user.click(screen.getByRole('option', { name: BRANCHES[0]!.name }));
    await user.click(screen.getByRole('checkbox', { name: BRANCHES[0]!.name }));
    // Unticked the order branch: one branch left, so it becomes the order branch.
    expect(screen.getByRole('combobox', { name: 'Chi nhánh nhận đơn' })).toHaveTextContent(
      BRANCHES[1]!.name,
    );
  });

  it('asks for the order branch when several are ticked and none chosen', async () => {
    const user = await toBranches({
      ...TEST_RESPONSE,
      branches: [...BRANCHES, { id: 13, name: 'Kho Bình Dương', address: null }],
    });
    // A becomes the order branch; unticking it leaves two ticked and no order branch.
    await user.click(screen.getByRole('checkbox', { name: BRANCHES[0]!.name }));
    await user.click(screen.getByRole('checkbox', { name: BRANCHES[1]!.name }));
    await user.click(screen.getByRole('checkbox', { name: 'Kho Bình Dương' }));
    await user.click(screen.getByRole('checkbox', { name: BRANCHES[0]!.name }));
    await user.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    expect(
      screen.getByText('Chọn chi nhánh nhận đơn trong các chi nhánh đã chọn.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Chi nhánh nhận đơn' })).toHaveFocus(),
    );
  });

  it('keeps entered values when going back', async () => {
    const user = await toBranches();
    await user.click(screen.getByRole('checkbox', { name: BRANCHES[1]!.name }));
    await user.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(screen.getByText('Bước 1/3')).toBeInTheDocument();
    expect(screen.getByLabelText('Tên gian hàng')).toHaveValue('shopabc');
    expect(screen.getByLabelText('Mã bảo mật')).toHaveValue('secret-1');
    await user.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
    await screen.findByText('Bước 2/3');
    expect(screen.getByRole('checkbox', { name: BRANCHES[1]!.name })).toBeChecked();
  });
});
