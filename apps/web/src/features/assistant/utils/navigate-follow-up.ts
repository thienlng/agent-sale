import type { AssistantStepDto } from '@agent-sales/contracts';

import { collectPageContext } from '@/lib/assistant-context';

/**
 * The fixed text of the one turn the panel sends by itself after a navigate, so the model sees
 * the new page's forms and can fill them (B11). The conversation hides it: the owner asked once.
 */
export const NAVIGATE_FOLLOW_UP_TEXT = '(trang đã mở; tiếp tục điền form)';

/** The owner asked to fill something ("điền", "fill"); accents are how owners type it. */
const FILL_WORDS = /điền|\bdien\b|\bfill\b/iu;

/**
 * Whether a turn that navigated still owes a fill: it produced no `fill_form`, and either the
 * model tried `ui_fill_form` and the form was not on the old page, or the owner asked to fill.
 */
export function owesFill(
  ownerText: string,
  steps: readonly AssistantStepDto[],
  filled: boolean,
): boolean {
  if (filled) return false;
  const triedFill = steps.some((s) => s.toolName === 'ui_fill_form' && s.ok === false);
  return triedFill || FILL_WORDS.test(ownerText);
}

/** The path part of an in-app href (`/app/x?y#z` → `/app/x`). */
function pathOf(href: string): string {
  return href.split(/[?#]/, 1)[0] ?? href;
}

/**
 * Resolves true once the router is on `href` and that page registered at least one form, false
 * after `timeoutMs`. Checks every 50 ms (the page mounts a moment after the navigate).
 */
export function waitForPageForm(
  href: string,
  currentPath: () => string,
  timeoutMs: number,
): Promise<boolean> {
  const target = pathOf(href);
  const ready = () =>
    currentPath() === target && (collectPageContext(target).forms?.length ?? 0) > 0;
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (ready()) resolve(true);
      else if (Date.now() - started >= timeoutMs) resolve(false);
      else setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  });
}
