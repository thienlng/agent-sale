import type { ConversationDto } from '@agent-sales/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FollowUpEditor } from './follow-up-editor';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/lib/session', () => ({
  useSession: () => ({ user: { id: 'sale-follow-up' }, workspaceId: 'workspace-follow-up' }),
}));
vi.mock('../api/inbox', () => ({
  useInboxActions: () => ({ update: { mutateAsync: mocks.update, isPending: false } }),
}));
const conversation = (id: string, patch: Partial<ConversationDto> = {}): ConversationDto => ({
  id,
  channelId: 'channel',
  provider: 'facebook',
  customerId: 'customer',
  customerName: 'Customer',
  mode: 'human',
  autoResumeAt: null,
  status: 'open',
  assigneeId: null,
  note: '',
  revision: 4,
  lastMessage: '',
  lastInboundAt: '2026-10-25T00:00:00.000Z',
  updatedAt: '2026-10-25T00:00:00.000Z',
  ...patch,
});
beforeEach(() => {
  mocks.update.mockReset();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-25T10:00:00.000Z'));
});
afterEach(() => vi.restoreAllMocks());
const tr = (key: string) => `channelInbox.sales.${key}`;
function edit(at = '2030-01-02T15:30', note = 'Call the customer') {
  fireEvent.click(screen.getByRole('button', { name: tr('followUpAdd') }));
  fireEvent.change(screen.getByLabelText(tr('followUpAt')), { target: { value: at } });
  fireEvent.change(screen.getByLabelText(tr('followUpNote')), { target: { value: note } });
}

describe('FollowUpEditor', () => {
  it('saves an absolute timestamp and private note with the original conversation revision', async () => {
    mocks.update.mockResolvedValue({});
    render(<FollowUpEditor conversation={conversation('follow-save')} />);
    edit();
    fireEvent.click(screen.getByRole('button', { name: tr('followUpSave') }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        followUpAt: new Date(2030, 0, 2, 15, 30).toISOString(),
        followUpNote: 'Call the customer',
        expectedRevision: 4,
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText(tr('followUpAt'))).not.toBeInTheDocument());
    expect(screen.getByText(new RegExp(tr('followUpTimezone')))).toHaveTextContent(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });
  it('keeps failed edits and blocks stale saves until the operator explicitly refreshes the revision', async () => {
    mocks.update.mockRejectedValue(new Error('CONFLICT'));
    const view = render(<FollowUpEditor conversation={conversation('follow-conflict')} />);
    edit();
    fireEvent.click(screen.getByRole('button', { name: tr('followUpSave') }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    view.rerender(
      <FollowUpEditor
        conversation={conversation('follow-conflict', {
          revision: 5,
          followUpAt: '2028-01-01T00:00:00.000Z',
          followUpNote: 'Other sale reminder',
        })}
      />,
    );
    expect(screen.getByLabelText(tr('followUpNote'))).toHaveValue('Call the customer');
    expect(screen.getByRole('button', { name: tr('followUpSave') })).toBeDisabled();
    expect(screen.getByText('Other sale reminder')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: tr('followUpKeepDraft') }));
    fireEvent.click(screen.getByRole('button', { name: tr('followUpSave') }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ expectedRevision: 5, followUpNote: 'Call the customer' }),
      ),
    );
  });
  it('shows due state only for an open conversation and clears persisted reminders explicitly', async () => {
    mocks.update.mockResolvedValue({});
    const c = conversation('follow-due', {
      followUpAt: '2026-10-25T09:00:00.000Z',
      followUpNote: 'Call now',
    });
    const view = render(<FollowUpEditor conversation={c} />);
    expect(screen.getByText(tr('followUpDue'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: tr('followUpClear') }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        followUpAt: null,
        followUpNote: '',
        expectedRevision: 4,
      }),
    );
    view.rerender(<FollowUpEditor conversation={{ ...c, status: 'resolved' }} />);
    expect(screen.queryByText(tr('followUpDue'))).not.toBeInTheDocument();
  });
  it('restores an in-flight draft after remount and clears it when the original save succeeds', async () => {
    let finish: (() => void) | undefined;
    mocks.update.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = render(<FollowUpEditor conversation={conversation('follow-remount')} />);
    edit();
    fireEvent.click(screen.getByRole('button', { name: tr('followUpSave') }));
    first.unmount();
    render(<FollowUpEditor conversation={conversation('follow-remount')} />);
    expect(screen.getByLabelText(tr('followUpNote'))).toHaveValue('Call the customer');
    await act(async () => {
      finish?.();
    });
    expect(screen.queryByLabelText(tr('followUpNote'))).not.toBeInTheDocument();
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
});
