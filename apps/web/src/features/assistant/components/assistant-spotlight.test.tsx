import { act, fireEvent, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { loadNamespace } from '@/lib/i18n';
import { renderWithProviders } from '@/testing/render';

import { useAssistantUi } from '../stores/assistant-ui.store';
import { AssistantSpotlight } from './assistant-spotlight';

function ProductsPage() {
  return (
    <>
      <button type="button" data-assistant-target="products.import">
        Nhập từ file
      </button>
      <AssistantSpotlight />
    </>
  );
}

beforeAll(() => loadNamespace('assistant'));
beforeEach(() => useAssistantUi.setState({ spotlight: null }));

describe('AssistantSpotlight', () => {
  it('points at the target with the hint and closes on Esc', async () => {
    renderWithProviders(<ProductsPage />);
    act(() =>
      useAssistantUi
        .getState()
        .setSpotlight({ target: 'products.import', hint: 'Bấm "Nhập từ file" để tải lên.' }),
    );

    expect(await screen.findByText('Bấm "Nhập từ file" để tải lên.')).toBeInTheDocument();
    expect(screen.getByTestId('assistant-spotlight-ring')).toBeInTheDocument();
    // The page keeps its focus: the spotlight never takes it.
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Bấm "Nhập từ file" để tải lên.')).not.toBeInTheDocument();
    expect(useAssistantUi.getState().spotlight).toBeNull();
  });

  it('closes on a click anywhere, and the click still reaches the page', async () => {
    let clicked = 0;
    renderWithProviders(
      <>
        <button type="button" data-assistant-target="orders.new" onClick={() => (clicked += 1)}>
          Tạo đơn
        </button>
        <AssistantSpotlight />
      </>,
    );
    act(() => useAssistantUi.getState().setSpotlight({ target: 'orders.new', hint: 'Ở đây' }));
    expect(await screen.findByText('Ở đây')).toBeInTheDocument();

    const button = screen.getByRole('button', { name: 'Tạo đơn' });
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(screen.queryByText('Ở đây')).not.toBeInTheDocument();
    expect(clicked).toBe(1);
  });
});
