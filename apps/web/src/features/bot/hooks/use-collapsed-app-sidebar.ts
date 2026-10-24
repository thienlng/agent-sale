import { useEffect, useRef } from 'react';

import { useSidebar } from '@/components/ui/sidebar';

/** shadcn's sidebar persists open/closed in this cookie on every setOpen. */
const COOKIE = 'sidebar_state';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/**
 * The bot space has its own menu, so the app sidebar shrinks to its icon rail
 * while it is open and comes back as it was on leave. The user's saved
 * preference (the cookie) is left untouched.
 */
export function useCollapsedAppSidebar() {
  const { open, setOpen } = useSidebar();
  const previous = useRef(open);
  const setOpenRef = useRef(setOpen);
  setOpenRef.current = setOpen;

  useEffect(() => {
    const wasOpen = previous.current;
    if (!wasOpen) return;
    setOpenRef.current(false);
    document.cookie = `${COOKIE}=true; path=/; max-age=${COOKIE_MAX_AGE}`;
    return () => setOpenRef.current(true);
  }, []);
}
