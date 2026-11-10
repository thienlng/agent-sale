import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useSignedInFavicon } from './favicon';

function Shell() {
  useSignedInFavicon();
  return null;
}

const icon = (type: string) =>
  document.querySelector(`link[rel="icon"][type="${type}"]`)?.getAttribute('href');

describe('useSignedInFavicon', () => {
  afterEach(() => {
    document.head.innerHTML = '';
  });

  it('shows the charcoal tile while signed in and the white tile after leaving', () => {
    document.head.innerHTML =
      '<link rel="icon" href="/favicon-light.svg" type="image/svg+xml" />' +
      '<link rel="icon" href="/favicon-light.png" type="image/png" sizes="64x64" />';
    const { unmount } = render(<Shell />);
    expect(icon('image/svg+xml')).toBe('/favicon.svg');
    expect(icon('image/png')).toBe('/favicon.png');
    unmount();
    expect(icon('image/svg+xml')).toBe('/favicon-light.svg');
    expect(icon('image/png')).toBe('/favicon-light.png');
  });
});
