import { useState } from 'react';

import { useSession } from '@/lib/session';
import { storage } from '@/lib/storage';

export type PropertiesView = 'cards' | 'list';

/** The Căn hộ page layout, remembered per user in this browser (storage failures → cards). */
export function usePropertiesView(): [PropertiesView, (view: PropertiesView) => void] {
  const userId = useSession()?.user.id ?? 'anonymous';
  const key = `rapiz.lodging.propertiesView.${userId}`;
  const [view, setView] = useState<PropertiesView>(() =>
    storage.get(key) === 'list' ? 'list' : 'cards',
  );
  return [
    view,
    (next) => {
      setView(next);
      storage.set(key, next);
    },
  ];
}
