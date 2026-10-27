import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { getSession, selectWorkspace } from '@/lib/session';

let inFlight = false;

/** Shared by the sidebar and overview; never carry resource IDs into another business. */
export function useBusinessSwitch() {
  const client = useQueryClient();
  const router = useRouter();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  async function choose(id: string): Promise<boolean> {
    const previous = getSession();
    if (!previous || inFlight || client.isMutating()) return false;
    if (!previous.memberships.some((member) => member.workspaceId === id)) return false;
    inFlight = true;
    setBusy(true);
    try {
      await router.navigate({ to: '/app/analytics', search: {} });
      // Existing route blockers can cancel navigation. Do not switch after cancellation/logout.
      if (router.state.location.pathname !== '/app/analytics' || getSession() !== previous)
        return false;
      if (id !== previous.workspaceId) {
        // Existing features use several tenant-key prefixes, so evict the entire read cache.
        await client.cancelQueries();
        if (client.isMutating() || getSession() !== previous) return false;
        client.removeQueries();
        if (!selectWorkspace(id)) return false;
      }
      return true;
    } catch {
      toast.error(t('business.switchError'));
      return false;
    } finally {
      inFlight = false;
      setBusy(false);
    }
  }
  return { busy, choose };
}
