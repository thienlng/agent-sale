import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/*
 * Rapiz Logo v2 "Primary / Faceted" master (brand identity release logo-v2, unchanged geometry):
 * the slim orange R symbol (180 x 154 units) with its hard-edged light and dark facets, and the
 * outlined Inter Tight Black Italic RAPIZ wordmark. Never redraw, stretch, rotate or recolour the
 * symbol; the wordmark follows `currentColor` so it is Charcoal on light surfaces and white on
 * the charcoal sidebar.
 */
const SYMBOL_PATHS = [
  'M14.4 0H156.6L180 41L162 75L139.5 85L171 136L121.5 125L85.5 85L114.3 58H126L134.969 41H55.8L14.4 0Z',
  'M42.3 56H87.3L56.7 121L0 154L42.3 56Z',
];
/** Lit facets: white at 12% over the orange. */
const FACET_LIGHT_PATHS = [
  'M14.4 0 55.8 41H86.4L45 0H14.4Z',
  'M114.3 58H126L139.5 85H85.5L114.3 58Z',
  'M42.3 56H87.3L72 89L42.3 56Z',
];
/** Shaded facets: Charcoal at 20% over the orange. */
const FACET_DARK_PATHS = [
  'M156.6 0 180 41 162 75 139.5 85 126 58 134.969 41 156.6 0Z',
  'M85.5 85H139.5L121.5 125L85.5 85Z',
  'M72 89 56.7 121 0 154 72 89Z',
];

/** The faceted symbol in its own 180 x 154 unit frame. */
function SymbolPaths() {
  return (
    <g fill="#FF7A45">
      {SYMBOL_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
      <g fill="#FFFFFF" fillOpacity={0.12}>
        {FACET_LIGHT_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g fill="#1F1F1F" fillOpacity={0.2}>
        {FACET_DARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </g>
  );
}

const WORDMARK_PATHS = [
  'M-1.285 87 13.196 0H50.799Q60.491 0 67.148 3.562Q73.804 7.123 76.723 13.721Q79.643 20.319 78.125 29.545Q76.607 38.887 71.381 45.31Q66.155 51.733 58.156 55.003Q50.156 58.272 40.172 58.272H17.75L20.903 39.938H38.537Q42.683 39.938 45.806 38.916Q48.93 37.895 50.915 35.588Q52.901 33.282 53.485 29.545Q54.36 23.998 51.266 21.429Q48.171 18.86 42.04 18.918H33.749L22.421 87ZM45.777 87 31.18 47.062H56.404L71.468 87Z',
  'M99.612 87H74.154L117.246 0H149.593L163.84 87H138.383L129.858 23.94H129.157ZM100.663 52.667H148.542L145.506 70.301H97.51Z',
  'M169.329 87 183.809 0H221.412Q231.105 0 237.703 3.854Q244.301 7.707 247.191 14.627Q250.081 21.546 248.505 30.83Q246.987 40.23 241.732 47.033Q236.477 53.835 228.419 57.513Q220.361 61.192 210.318 61.192H187.897L190.933 42.858H208.566Q212.829 42.858 216.069 41.398Q219.31 39.938 221.295 37.223Q223.281 34.508 223.864 30.83Q224.507 27.034 223.368 24.378Q222.23 21.721 219.544 20.29Q216.858 18.86 212.654 18.918H204.362L193.035 87Z',
  'M283.071 0 268.707 87H245.001L259.482 0Z',
  'M277.407 87 279.626 73.921 329.958 19.035H288.852L292.005 0H363.006L360.904 13.079 310.572 67.965H351.679L348.409 87Z',
];

/** The faceted orange R alone. Decorative: give it a label at the call site when it stands alone. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 180 154"
      aria-hidden
      focusable="false"
      className={cn('h-6 w-auto shrink-0', className)}
    >
      <SymbolPaths />
    </svg>
  );
}

/**
 * The Rapiz signature (R + RAPIZ) in the master lockup proportions, or only the R when
 * `markOnly`. The accessible name is the product name.
 */
export function Logo({ className, markOnly }: { className?: string; markOnly?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className={cn('inline-flex items-center', className)}>
      {markOnly ? (
        <BrandMark className="h-6" />
      ) : (
        // Master lockup: symbol at (0,0), wordmark cap top 37 units lower at x=200.
        <svg viewBox="-2 0 566 154" aria-hidden focusable="false" className="h-6 w-auto shrink-0">
          <SymbolPaths />
          <g fill="currentColor" transform="translate(200 37)">
            {WORDMARK_PATHS.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </svg>
      )}
      <span className="sr-only">{t('app.name')}</span>
    </span>
  );
}
