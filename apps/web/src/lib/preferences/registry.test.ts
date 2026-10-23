import { afterEach, describe, expect, it } from 'vitest';

import { bootScript, PREFERENCE_KEYS, PREFERENCES, storageKey } from './registry';

function runBoot() {
  // The same code index.html runs before the app loads.
  new Function(bootScript())();
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  for (const key of PREFERENCE_KEYS)
    document.documentElement.removeAttribute(PREFERENCES[key].attribute);
});

describe('preferences boot script', () => {
  it('applies the defaults when nothing is stored', () => {
    runBoot();
    for (const key of PREFERENCE_KEYS) {
      expect(document.documentElement.getAttribute(PREFERENCES[key].attribute)).toBe(
        PREFERENCES[key].defaultValue,
      );
    }
  });

  it('applies stored values and the dark class, and ignores unknown values', () => {
    localStorage.setItem(storageKey('theme_mode'), 'dark');
    localStorage.setItem(storageKey('sidebar_variant'), 'floating');
    localStorage.setItem(storageKey('content_layout'), '<script>');
    runBoot();
    const html = document.documentElement;
    expect(html.classList.contains('dark')).toBe(true);
    expect(html.getAttribute('data-sidebar-variant')).toBe('floating');
    expect(html.getAttribute('data-content-layout')).toBe('centered');
  });
});
