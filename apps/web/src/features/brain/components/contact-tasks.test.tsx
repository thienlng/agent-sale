import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithRouter, stubFetch } from '@/testing/render';

import { ContactTasks } from './conversation-brain';

const WS = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a01';
const CONTACT = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a02';
const TASK = '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a03';
vi.mock('@/lib/use-workspace', () => ({ useWorkspaceId: () => WS }));
vi.mock('@/lib/permissions', () => ({ useCan: () => true }));
beforeAll(async () => {
  await loadNamespace('brain');
});
afterEach(() => vi.unstubAllGlobals());

const task = {
  id: TASK,
  title: 'Khách đổi lịch – Demo Tuan',
  note: null,
  dueAt: '2026-11-14T02:00:00.000Z',
  assigneeUserId: null,
  assigneeName: 'Lan',
  status: 'open',
  contactId: CONTACT,
  conversationId: null,
  subjectType: null,
  subjectId: null,
  source: 'bot',
  createdAt: '2026-11-13T02:00:00.000Z',
  doneAt: null,
  version: 1,
};
const LIST = `GET /tasks?contactId=${CONTACT}&scope=all&status=open`;

describe('ContactTasks (MS2-8)', () => {
  it("lists the customer's open tasks with due time and assignee, and completes one", async () => {
    const { fetchStub, calls } = stubFetch({
      [LIST]: { status: 200, body: { data: [task], page: { nextCursor: null } } },
      [`POST /tasks/${TASK}/complete`]: { status: 200, body: { ...task, status: 'done' } },
    });
    vi.stubGlobal('fetch', fetchStub);
    renderWithRouter(() => <ContactTasks contactId={CONTACT} />);
    expect(await screen.findByRole('heading', { name: 'Việc cần làm' })).toBeVisible();
    expect(screen.getByText('Khách đổi lịch – Demo Tuan')).toBeVisible();
    expect(screen.getByText(/09:00 14\/11\/2026/)).toBeVisible();
    expect(screen.getByText('Lan')).toBeVisible();
    await userEvent.click(screen.getByRole('checkbox'));
    await waitFor(() =>
      expect(calls.some((c) => c.key === `POST /tasks/${TASK}/complete`)).toBe(true),
    );
  });

  it('shows nothing when the customer has no open task', async () => {
    const { fetchStub, calls } = stubFetch({
      [LIST]: { status: 200, body: { data: [], page: { nextCursor: null } } },
    });
    vi.stubGlobal('fetch', fetchStub);
    const view = renderWithRouter(() => <ContactTasks contactId={CONTACT} />);
    await waitFor(() => expect(calls.some((c) => c.key === LIST)).toBe(true));
    expect(screen.queryByRole('heading', { name: 'Việc cần làm' })).toBeNull();
    view.unmount();
  });
});
