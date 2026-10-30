import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter } from '@/testing/render';

import { FaqTable } from './faq-table';

const base = {
  botId: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9a00',
  source: 'seed',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function faq(id: string, answer: string, missing: string[]) {
  return { ...base, id, question: `Q ${id}`, answer, missingPlaceholders: missing };
}

describe('FaqTable', () => {
  it('flags an FAQ with an unfilled placeholder as unused by the bot', async () => {
    renderWithRouter(() => (
      <FaqTable
        rows={
          [
            faq('a', 'Hotline {{store.hotline}}', ['store.hotline']),
            faq('b', 'Mở cửa 8h', []),
          ] as never
        }
        offset={0}
        selected={new Set()}
        onToggle={vi.fn()}
        onToggleAll={vi.fn()}
        onOpen={vi.fn()}
      />
    ));
    const badges = await screen.findAllByText('Bot không dùng câu này — hãy sửa câu trả lời');
    expect(badges).toHaveLength(1);
  });
});
