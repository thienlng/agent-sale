/**
 * UI preferences the user can choose (model ported from the Studio Admin
 * template, arhamkhnz/next-shadcn-admin-dashboard, MIT). Each one is stored
 * per browser in localStorage and applied as a `data-*` attribute on <html>,
 * which the CSS and the shell read. Pure data: also imported by vite.config.ts
 * to generate the boot script that applies them before the first paint.
 */
export const PREFERENCES = {
  theme_mode: {
    values: ['light', 'dark', 'system'],
    defaultValue: 'light',
    attribute: 'data-theme-mode',
  },
  theme_preset: {
    values: ['rapiz', 'ocean', 'forest', 'graphite'],
    defaultValue: 'rapiz',
    attribute: 'data-theme-preset',
  },
  sidebar_variant: {
    values: ['sidebar', 'inset', 'floating'],
    defaultValue: 'sidebar',
    attribute: 'data-sidebar-variant',
  },
  sidebar_collapsible: {
    values: ['icon', 'offcanvas'],
    defaultValue: 'icon',
    attribute: 'data-sidebar-collapsible',
  },
  content_layout: {
    values: ['centered', 'full-width'],
    defaultValue: 'centered',
    attribute: 'data-content-layout',
  },
  navbar_style: {
    values: ['sticky', 'scroll'],
    defaultValue: 'sticky',
    attribute: 'data-navbar-style',
  },
} as const;

export type PreferenceKey = keyof typeof PREFERENCES;
export type PreferenceValues = {
  [K in PreferenceKey]: (typeof PREFERENCES)[K]['values'][number];
};

export const PREFERENCE_KEYS = Object.keys(PREFERENCES) as PreferenceKey[];

/** localStorage key of a preference. */
export const storageKey = (key: PreferenceKey) => `rapiz.pref.${key}`;

/** Swatch shown next to each preset in the picker (its light-mode primary). */
export const PRESET_SWATCH: Record<PreferenceValues['theme_preset'], string> = {
  rapiz: '#f26b1d',
  ocean: '#2563eb',
  forest: '#15803d',
  graphite: '#27272a',
};

/**
 * Inline script for index.html <head>: reads stored preferences, falls back to
 * defaults for unknown values, sets the attributes and the `.dark` class.
 * Generated from PREFERENCES so the boot path and the app cannot drift.
 */
export function bootScript(): string {
  const registry = JSON.stringify(PREFERENCES);
  return `(function(){try{var R=${registry},d=document.documentElement,v={};
for(var k in R){var x=null;try{x=localStorage.getItem('rapiz.pref.'+k)}catch(e){}
v[k]=R[k].values.indexOf(x)>=0?x:R[k].defaultValue;d.setAttribute(R[k].attribute,v[k]);}
var dark=v.theme_mode==='dark'||(v.theme_mode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
d.classList.toggle('dark',dark);d.style.colorScheme=dark?'dark':'light';}catch(e){}})();`;
}
