import { useState } from 'react';

import { storage } from '@/lib/storage';
import { useWorkspaceId } from '@/lib/use-workspace';

const key = (ws: string) => `rapiz.pmsHint.dismissed.${ws}`;

/**
 * Whether the owner closed the "Using KiotViet?" card on the products list, per workspace and
 * browser. Storage failures (private windows) only mean the card shows again.
 */
export function usePmsHintDismissed(): [boolean, () => void] {
  const ws = useWorkspaceId();
  // Keyed by workspace so switching workspaces reads that workspace's choice.
  const [dismissedIn, setDismissedIn] = useState<string | null>(null);
  return [
    dismissedIn === ws || storage.get(key(ws)) === '1',
    () => {
      storage.set(key(ws), '1');
      setDismissedIn(ws);
    },
  ];
}
