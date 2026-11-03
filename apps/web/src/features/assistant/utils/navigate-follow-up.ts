import type { AssistantStepDto } from '@agent-sales/contracts';

import { formsSinceMark } from '@/lib/assistant-context';

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

/** How long the page being left may keep its forms registered once the new page has its own. */
export const STALE_FORM_GRACE_MS = 500;

/**
 * Resolves true once the router is on `href` and the new page registered a form after `mark`
 * (taken before the navigate), false after `timeoutMs`. Forms registered before the mark belong
 * to the page being left, which can stay mounted a moment after the path changed (B11b): the
 * wait also lets them unmount, up to `STALE_FORM_GRACE_MS`, so the follow-up's page context
 * carries only the new page's forms. Checks every 50 ms.
 */
export function waitForPageForm(
  href: string,
  currentPath: () => string,
  timeoutMs: number,
  mark: number,
): Promise<boolean> {
  const target = pathOf(href);
  return new Promise((resolve) => {
    const started = Date.now();
    let freshSince: number | null = null;
    const tick = () => {
      const now = Date.now();
      const { fresh, stale } = formsSinceMark(mark);
      if (currentPath() === target && fresh) {
        freshSince ??= now;
        if (!stale || now - freshSince >= STALE_FORM_GRACE_MS) return resolve(true);
      } else {
        freshSince = null;
      }
      if (now - started >= timeoutMs) resolve(false);
      else setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  });
}
