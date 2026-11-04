import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithProviders } from '@/testing/render';

import { AssistantComposer } from './assistant-composer';

describe('AssistantComposer', () => {
  beforeAll(() => loadNamespace('assistant'));

  it('lets the owner type while a turn runs but holds the send', async () => {
    const onSend = vi.fn(() => Promise.resolve(true));
    const view = renderWithProviders(<AssistantComposer sending onSend={onSend} />);
    const box = screen.getByRole('textbox');
    expect(box).toBeEnabled();
    const user = userEvent.setup();
    await user.type(box, 'Câu tiếp theo{Enter}');
    expect(box).toHaveValue('Câu tiếp theo');
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();

    view.rerender(<AssistantComposer sending={false} onSend={onSend} />);
    await user.type(box, '{Enter}');
    expect(onSend).toHaveBeenCalledWith('Câu tiếp theo');
    expect(box).toHaveValue('');
  });
});
