import type { AssistantPageContext } from '@agent-sales/contracts';
import { useEffect } from 'react';
import { create } from 'zustand';

/** What a page says about itself; the route and the on-screen targets are added at send time. */
export type AssistantPageInfo = Omit<AssistantPageContext, 'route' | 'targets'>;

const usePageInfo = create<{ info: AssistantPageInfo | null }>()(() => ({ info: null }));

/**
 * Pages call this to describe themselves to the owner assistant (title, entity ids, empty fields,
 * errors). The description is dropped when the page unmounts. Pass a stable or memoised object.
 */
export function useAssistantContext(ctx: AssistantPageInfo): void {
  const key = JSON.stringify(ctx);
  useEffect(() => {
    usePageInfo.setState({ info: JSON.parse(key) as AssistantPageInfo });
    return () => usePageInfo.setState({ info: null });
  }, [key]);
}

const MAX_TARGETS = 40;

/** The page context sent with a message: the page's own description, its route and targets. */
export function collectPageContext(route: string): AssistantPageContext {
  const targets = [
    ...new Set(
      Array.from(document.querySelectorAll<HTMLElement>('[data-assistant-target]'))
        .map((el) => el.dataset['assistantTarget'] ?? '')
        .filter((id) => id && id.length <= 60),
    ),
  ].slice(0, MAX_TARGETS);
  const info = usePageInfo.getState().info;
  return {
    ...info,
    route: route.slice(0, 200),
    ...(targets.length ? { targets } : {}),
  };
}
