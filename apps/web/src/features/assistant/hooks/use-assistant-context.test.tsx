import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { collectPageContext, useAssistantContext } from './use-assistant-context';

function ProductPage() {
  useAssistantContext({ title: 'Áo thun', entity: { productId: 'p-1' }, emptyFields: ['price'] });
  return (
    <>
      <button data-assistant-target="products.new">Thêm</button>
      <button data-assistant-target="products.new">Thêm</button>
      <button data-assistant-target="products.import">Nhập</button>
    </>
  );
}

describe('useAssistantContext', () => {
  it('sends what the page said, its route and the targets on screen, until it unmounts', () => {
    const { unmount } = render(<ProductPage />);
    expect(collectPageContext('/app/products/p-1')).toEqual({
      title: 'Áo thun',
      entity: { productId: 'p-1' },
      emptyFields: ['price'],
      route: '/app/products/p-1',
      targets: ['products.new', 'products.import'],
    });
    unmount();
    expect(collectPageContext('/app/orders')).toEqual({ route: '/app/orders' });
  });
});
