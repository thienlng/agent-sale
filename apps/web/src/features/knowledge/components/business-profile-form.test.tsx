import { Link } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, stubFetch } from '@/testing/render';

import { BusinessProfileForm } from './business-profile-form';

const can = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => 'ws-1' }));
vi.mock('@/lib/permissions', () => ({ useCan: () => can.value }));
beforeEach(() => {
  can.value = true;
});
afterEach(() => vi.unstubAllGlobals());

const BOT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a00';

function bot(
  fields: Record<string, string> = {},
  notes = '',
  industry = 'hotel',
): Record<string, unknown> {
  return {
    id: BOT,
    name: 'Bot',
    industry,
    isActive: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    settings: {
      mission: '',
      greeting: '',
      selfPronoun: 'em',
      customerPronoun: 'anh/chị',
      useCustomerName: true,
      fallbackMessage: 'x',
      handoffMessage: 'x',
      creativity: 'balanced',
      modelTier: 'smart',
      language: 'vi',
      placeholders: {},
      profile: { fields, notes },
    },
  };
}

async function setup(initial = bot(), saved: Record<string, unknown> = initial) {
  let current = initial;
  const routes = {
    // After a PATCH the server returns the saved bot to every later read.
    get [`GET /bots/${BOT}`]() {
      return { status: 200, body: current };
    },
    get [`PATCH /bots/${BOT}`]() {
      current = saved;
      return { status: 200, body: saved };
    },
  };
  const stub = stubFetch(routes);
  vi.stubGlobal('fetch', stub.fetchStub);
  renderWithRouter(() => (
    <>
      <BusinessProfileForm botId={BOT} />
      <Link to="/app/bots">go-away</Link>
    </>
  ));
  await screen.findByLabelText(/Tên gọi với khách/, undefined, { timeout: 10_000 });
  return stub;
}

describe('BusinessProfileForm', () => {
  it('shows the basic and hotel fields, the template and the completeness bar', async () => {
    await setup(bot({ address: '12 Lê Lợi', hotline: '0901' }));
    for (const label of ['Địa chỉ', 'Link Google Maps', 'Hotline / Zalo', 'Giờ làm việc']) {
      expect(screen.getByLabelText(new RegExp(label))).toBeInTheDocument();
    }
    for (const label of ['Loại căn & sức chứa', 'Giá tham khảo', 'Nhận / trả phòng', 'Tiện ích']) {
      expect(screen.getByLabelText(new RegExp(label))).toBeInTheDocument();
    }
    expect(screen.queryByLabelText(/Bảng size/)).not.toBeInTheDocument();
    expect(screen.getByText('Đã điền 2/13')).toBeInTheDocument();
    expect(screen.getByText(/Mẫu: Khách sạn \/ homestay \(theo business\)/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Thông tin cơ bản' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Theo ngành' })).toBeInTheDocument();
  });

  it('marks empty fields with a warning and drops it once filled', async () => {
    await setup(bot({ address: '12 Lê Lợi' }));
    expect(screen.getAllByRole('img', { name: /Chưa điền/ })).toHaveLength(12);
    await userEvent.type(screen.getByLabelText(/Hotline/), '0901');
    expect(screen.getAllByRole('img', { name: /Chưa điền/ })).toHaveLength(11);
    expect(screen.getByText('Đã điền 2/13')).toBeInTheDocument();
  });

  it('counts the notes and limits them to 3000 characters', async () => {
    await setup(bot({}, 'abc'));
    const notes = screen.getByLabelText(/Ghi chú thêm/);
    expect(notes).toHaveAttribute('maxlength', '3000');
    expect(screen.getByText('3 / 3000')).toBeInTheDocument();
    await userEvent.type(notes, 'de');
    expect(screen.getByText('5 / 3000')).toBeInTheDocument();
    // Notes are excluded from the completeness bar.
    expect(screen.getByText('Đã điền 0/13')).toBeInTheDocument();
  });

  it('uses examples as placeholders only and never sends them', async () => {
    const stub = await setup();
    expect(screen.getByLabelText(/Hotline/)).toHaveAttribute('placeholder', 'Ví dụ: 0901 234 567');
    expect(screen.getByLabelText(/Hotline/)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
    expect(stub.calls.some((c) => c.key.startsWith('PATCH'))).toBe(false);
  });

  it('saves only the changed keys, clearing with an empty string, and not the notes', async () => {
    const stub = await setup(
      bot({ address: 'Old', hours: '8-5' }, 'keep'),
      bot({ address: 'New' }),
    );
    const save = screen.getByRole('button', { name: 'Lưu thay đổi' });
    await userEvent.clear(screen.getByLabelText(/Địa chỉ/));
    await userEvent.type(screen.getByLabelText(/Địa chỉ/), 'New');
    await userEvent.clear(screen.getByLabelText(/Giờ làm việc/));
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(stub.calls.some((c) => c.key.startsWith('PATCH'))).toBe(true));
    const patch = stub.calls.find((c) => c.key === `PATCH /bots/${BOT}`);
    expect(patch?.body).toEqual({
      settings: { profile: { fields: { address: 'New', hours: '' } } },
    });
  });

  it('sends the notes only when they changed', async () => {
    const stub = await setup(bot({}, 'old'));
    await userEvent.type(screen.getByLabelText(/Ghi chú thêm/), '!');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(stub.calls.some((c) => c.key.startsWith('PATCH'))).toBe(true));
    expect(stub.calls.find((c) => c.key.startsWith('PATCH'))?.body).toEqual({
      settings: { profile: { notes: 'old!' } },
    });
  });

  it('shows the saved values again after the save and disables Save', async () => {
    await setup(bot({ address: 'Old' }), bot({ address: 'New' }));
    await userEvent.clear(screen.getByLabelText(/Địa chỉ/));
    await userEvent.type(screen.getByLabelText(/Địa chỉ/), 'New');
    await userEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled(),
    );
    expect(screen.getByLabelText(/Địa chỉ/)).toHaveValue('New');
  });

  it('rejects a Google Maps link that is not https', async () => {
    await setup();
    await userEvent.type(screen.getByLabelText(/Link Google Maps/), 'http://maps.example');
    expect(screen.getByText('Link phải bắt đầu bằng https://')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
  });

  it('asks before leaving with unsaved changes', async () => {
    await setup();
    await userEvent.type(screen.getByLabelText(/Hotline/), '0901');
    await userEvent.click(screen.getByText('go-away'));
    expect(await screen.findByText('Rời trang sẽ mất các thay đổi chưa lưu.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ở lại' }));
    expect(screen.getByLabelText(/Hotline/)).toHaveValue('0901');
  });

  it('does not ask when nothing changed', async () => {
    await setup();
    await userEvent.click(screen.getByText('go-away'));
    await waitFor(() => expect(screen.queryByLabelText(/Hotline/)).not.toBeInTheDocument());
  });

  it('is read-only without the manage capability', async () => {
    can.value = false;
    await setup(bot({ address: 'A' }));
    expect(screen.getByLabelText(/Địa chỉ/)).toBeDisabled();
    expect(screen.getByLabelText(/Ghi chú thêm/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Lưu thay đổi' })).not.toBeInTheDocument();
  });

  it('shows only the basic group for an industry without its own block', async () => {
    await setup(bot({}, '', 'other'));
    expect(screen.queryByRole('group', { name: 'Theo ngành' })).not.toBeInTheDocument();
    expect(screen.getByText('Đã điền 0/5')).toBeInTheDocument();
  });
});
