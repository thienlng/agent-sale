import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter, stubFetch } from '@/testing/render';

import { CreateBusinessPage } from './create-business-page';

const WORKSPACE = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9d01',
  name: 'Shop Hoa',
  industry: 'retail',
  timezone: 'Asia/Ho_Chi_Minh',
  createdAt: '2026-10-28T00:00:00.000Z',
};

describe('CreateBusinessPage', () => {
  it('creates the business at account level with the chosen name and industry', async () => {
    const { fetchStub, calls } = stubFetch({
      'POST /workspaces': { status: 201, body: WORKSPACE },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <CreateBusinessPage />);

    await userEvent.type(await screen.findByLabelText(/tên business/i), '  Shop Hoa ');
    await userEvent.click(screen.getByRole('button', { name: /tạo business/i }));

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.key).toBe('POST /workspaces');
    expect(calls[0]?.body).toEqual({ name: 'Shop Hoa', industry: 'retail' });
    // Creating a business is not scoped to another business.
    expect(calls[0]?.headers['X-Workspace-Id']).toBeUndefined();
  });

  it('shows a clear message when the account may not create more businesses', async () => {
    const { fetchStub } = stubFetch({
      'POST /workspaces': {
        status: 403,
        body: { error: { code: 'FORBIDDEN', message: 'no' } },
      },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <CreateBusinessPage />);

    await userEvent.type(await screen.findByLabelText(/tên business/i), 'Shop B');
    await userEvent.click(screen.getByRole('button', { name: /tạo business/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/không được tạo thêm/i);
  });

  it('does nothing for a blank name', async () => {
    const { fetchStub, calls } = stubFetch({});
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <CreateBusinessPage />);

    await userEvent.type(await screen.findByLabelText(/tên business/i), '   ');
    await userEvent.click(screen.getByRole('button', { name: /tạo business/i }));
    expect(calls).toHaveLength(0);
  });
});
