import type { TrainingHistoryDto } from '@agent-sales/contracts';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/testing/render';

import { HistoryEntry } from './history-entry';

const entry = (changes: TrainingHistoryDto['changes']): TrainingHistoryDto =>
  ({
    id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a01',
    botId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a00',
    itemId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a00',
    title: 'Shop',
    kind: 'settings',
    action: 'updated',
    actor: 'Ken',
    restorable: false,
    createdAt: '2026-10-29T00:00:00.000Z',
    changes,
  }) as TrainingHistoryDto;

describe('HistoryEntry', () => {
  it('renders a profile change per changed key, with notes as extra information', () => {
    const { container } = renderWithProviders(
      <ul>
        <HistoryEntry
          onRestore={vi.fn()}
          entry={entry([
            {
              field: 'profile',
              before: { fields: { hotline: '0901' }, notes: '' },
              after: { fields: { hotline: '0902' }, notes: 'Nghỉ Tết' },
            },
          ])}
        />
      </ul>,
    );
    expect(container.textContent).not.toContain('[object Object]');
    expect(screen.getByText(/Hotline/i)).toBeTruthy();
    expect(screen.getByText('0902')).toBeTruthy();
    expect(screen.getByText(/Thông tin thêm/)).toBeTruthy();
    expect(screen.getByText('Nghỉ Tết')).toBeTruthy();
  });

  it('labels tone, reply length and emoji changes', () => {
    renderWithProviders(
      <ul>
        <HistoryEntry
          onRestore={vi.fn()}
          entry={entry([
            { field: 'tone', before: 'friendly', after: 'formal' },
            { field: 'replyLength', before: 'short', after: 'veryShort' },
            { field: 'allowEmoji', before: false, after: true },
          ])}
        />
      </ul>,
    );
    expect(screen.getByText('Lịch sự trang trọng')).toBeTruthy();
    expect(screen.getByText('Rất ngắn')).toBeTruthy();
    expect(screen.getByText(/Giọng điệu/)).toBeTruthy();
    expect(screen.getByText(/Cho phép emoji/)).toBeTruthy();
  });
});
