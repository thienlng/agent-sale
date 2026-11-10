import type { PageLink, PageSection } from './types.js';

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

const MAX_LINKS = 24;
const MAX_SECTION_LINKS = 12;
const MAX_LABEL = 80;
const MAX_URL = 1000;

/** Rendered text (line breaks become spaces); `textContent` where there is no layout. */
const textOf = (el: Element | null | undefined): string =>
  el ? (el as HTMLElement).innerText || el.textContent || '' : '';

const heading = (el: Element): string =>
  el.getAttribute('data-rapiz-label') ||
  el.getAttribute('aria-label') ||
  textOf(el.querySelector('h1,h2,h3'));

/**
 * Places on the site the bot may suggest (ADR-029): the sections of this page (an element with an
 * `id` that is a `<section>` or a marked part, labelled by `data-rapiz-label`, `aria-label` or its
 * first heading), then the same-site links of the header, navigation and footer. Labels and URLs
 * are clipped to the contract; the server keeps same-origin targets only and drops the query.
 */
export function pageNav(doc: Document = document, href: string = window.location.href): PageLink[] {
  const here = new URL(href);
  const base = `${here.origin}${here.pathname}`;
  const out: PageLink[] = [];
  const seen = new Set<string>();
  const add = (label: string, url: string): void => {
    const text = clean(label, MAX_LABEL);
    if (!text || seen.has(url) || url.length > MAX_URL || out.length >= MAX_LINKS) return;
    seen.add(url);
    out.push({ label: text, url });
  };

  for (const el of doc.querySelectorAll(`section[id],[${MARK}]`)) {
    if (out.length >= MAX_SECTION_LINKS) break;
    if (el.closest('[data-rapiz-widget]')) continue;
    const id = el.id || el.getAttribute(MARK) || '';
    if (!id) continue;
    add(heading(el) || id.replace(/[-_]+/g, ' '), `${base}#${encodeURIComponent(id)}`);
  }
  for (const a of doc.querySelectorAll<HTMLAnchorElement>(
    'header a[href],nav a[href],footer a[href]',
  )) {
    let url: URL;
    try {
      url = new URL(a.getAttribute('href') ?? '', here.href);
    } catch {
      continue;
    }
    if (url.origin !== here.origin || !/^https?:$/.test(url.protocol)) continue;
    const hash = url.hash.length > 1 ? url.hash : '';
    if (url.pathname === here.pathname && !hash) continue;
    add(textOf(a) || a.getAttribute('aria-label') || '', `${url.origin}${url.pathname}${hash}`);
  }
  return out;
}

/** The element a `#fragment` of this page names: its `id`, else a marked part of that name. */
export function sectionTarget(hash: string, doc: Document = document): HTMLElement | null {
  let name = hash.replace(/^#/, '');
  try {
    name = decodeURIComponent(name);
  } catch {
    /* keep it as it is */
  }
  if (!name) return null;
  const byId = doc.getElementById(name);
  if (byId) return byId;
  for (const el of doc.querySelectorAll<HTMLElement>(`[${MARK}]`))
    if (el.getAttribute(MARK) === name) return el;
  return null;
}
