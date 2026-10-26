import type { TagDto } from '@agent-sales/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/testing/render';
import { TagValuesDialog } from './tag-values-dialog';

const tag: TagDto = {
  id: 'tag',
  name: 'Ticket',
  color: '#16a34a',
  type: 'attribute',
  description: '',
  schemaVersion: 1,
  isSystem: false,
  archived: false,
  createdByName: null,
  activeCount: 0,
  version: 1,
  updatedAt: '2026-10-26T00:00:00.000Z',
  fields: [
    {
      key: 'priority',
      label: 'Priority',
      type: 'select',
      required: true,
      archived: false,
      options: [
        { id: 'high', label: 'High', archived: false },
        { id: 'old', label: 'Archived choice', archived: true },
      ],
    },
  ],
};
it('requires a real selection and hides archived choices', async () => {
  const save = vi.fn();
  renderWithProviders(
    <TagValuesDialog tag={tag} initial={{}} pending={false} onSave={save} onClose={vi.fn()} />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Lưu' }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Priority');
  screen.getByRole('combobox', { name: 'Priority *' }).focus();
  await user.keyboard('{ArrowDown}');
  expect(screen.queryByRole('option', { name: 'Archived choice' })).not.toBeInTheDocument();
  (await screen.findByRole('option', { name: 'High' })).focus();
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('button', { name: 'Lưu' }));
  expect(save).toHaveBeenCalledWith({ priority: 'high' });
});
