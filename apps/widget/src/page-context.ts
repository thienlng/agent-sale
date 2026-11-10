import type { PageSection } from './types.js';

/** Elements the site marked as a meaningful part of the page (opt-in: nothing else is read). */
const MARK = 'data-rapiz-section';
const CONTEXT = 'data-rapiz-context';
const MAX_SECTIONS = 3;
const MAX_NAME = 80;
const MAX_TEXT = 400;

const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

function visibleArea(el: Element, width: number, height: number): number {
  const r = el.getBoundingClientRect();
  const w = Math.min(r.right, width) - Math.max(r.left, 0);
  const h = Math.min(r.bottom, height) - Math.max(r.top, 0);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The marked parts of the page the visitor has on screen, most specific first: a marked element
 * with a visible marked element inside (a pricing section around its plan cards) only fills the
 * slots its visible children leave. Each kind is ordered by visible area. The text is the
 * element's `data-rapiz-context`, else its own text.
 */
export function visibleSections(
  doc: Document = document,
  width: number = window.innerWidth,
  height: number = window.innerHeight,
): PageSection[] {
  const visible = [...doc.querySelectorAll(`[${MARK}]`)]
    .map((el) => ({ el, area: visibleArea(el, width, height) }))
    .filter((v) => v.area > 0);
  const isParent = (el: Element) => visible.some((v) => v.el !== el && el.contains(v.el));
  const byArea = (a: { area: number }, b: { area: number }) => b.area - a.area;
  const leaves = visible.filter((v) => !isParent(v.el)).sort(byArea);
  const parents = visible.filter((v) => isParent(v.el)).sort(byArea);
  return [...leaves, ...parents]
    .map(({ el }) => ({
      name: clean(el.getAttribute(MARK) ?? '', MAX_NAME),
      // innerText skips hidden text; textContent covers environments without layout.
      text: clean(
        el.getAttribute(CONTEXT) ?? (el as HTMLElement).innerText ?? el.textContent ?? '',
        MAX_TEXT,
      ),
    }))
    .filter((s) => s.name)
    .slice(0, MAX_SECTIONS);
}
