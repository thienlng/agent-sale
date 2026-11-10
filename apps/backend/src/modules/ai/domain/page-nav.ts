import type { WebsitePageContext } from '@agent-sales/contracts';

/** A place the bot may send a website visitor to, as it sees it (`id`) and as the widget opens it. */
export interface NavTarget {
  /** `n1`, `n2`… in the order the page listed them. */
  id: string;
  label: string;
  /** Absolute URL without query: `origin + path (+ #fragment)`. */
  url: string;
  /** Path plus fragment, shown to the model. */
  path: string;
  /** A section of the page the visitor is on (scrolls instead of loading a page). */
  here: boolean;
}

const parse = (raw: string, base?: string): URL | null => {
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
};

/**
 * The visitor page's sections and links the bot may suggest: http(s) only, on the page's own
 * origin, query dropped (it can carry the visitor's data), the page itself without a fragment
 * left out, duplicates removed. The page reported them, so labels stay untrusted text.
 */
export function navTargets(page: WebsitePageContext | undefined): NavTarget[] {
  const current = page ? parse(page.url) : null;
  if (!page || !current || !/^https?:$/.test(current.protocol)) return [];
  const seen = new Set<string>();
  const targets: NavTarget[] = [];
  for (const link of page.nav ?? []) {
    const url = parse(link.url, current.href);
    if (!url || url.origin !== current.origin) continue;
    const hash = url.hash.length > 1 ? url.hash : '';
    const here = url.pathname === current.pathname;
    if (here && !hash) continue;
    const clean = `${url.origin}${url.pathname}${hash}`;
    const label = link.label.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!label || seen.has(clean)) continue;
    seen.add(clean);
    targets.push({
      id: `n${targets.length + 1}`,
      label,
      url: clean,
      path: `${url.pathname}${hash}`,
      here,
    });
  }
  return targets;
}
