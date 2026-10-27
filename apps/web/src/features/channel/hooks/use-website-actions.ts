import type { CreateWebsiteRequest, UpdateWebsiteRequest } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useCreateWebsite, useUpdateChannel, useUpdateWebsite } from '../api/channels';

/** Mutations of the website cards with their toasts; each resolves true on success. */
export function useWebsiteActions() {
  const { t } = useTranslation();
  const tw = (key: string) => t(`channelInbox.integrations.website.${key}`);
  const create = useCreateWebsite();
  const update = useUpdateWebsite();
  const disconnect = useUpdateChannel();

  return {
    busy: create.isPending || update.isPending || disconnect.isPending,
    creating: create.isPending,
    updating: update.isPending,
    /** Resolves with the new connection, or null after an error toast. */
    async createSite(body: CreateWebsiteRequest) {
      try {
        const site = await create.mutateAsync(body);
        toast.success(tw('created'));
        return site;
      } catch {
        toast.error(tw('createFailed'));
        return null;
      }
    },
    async updateSite(id: string, body: UpdateWebsiteRequest, message?: string) {
      try {
        await update.mutateAsync({ id, body });
        toast.success(message ?? tw('settingsSaved'));
        return true;
      } catch {
        toast.error(tw('updateFailed'));
        return false;
      }
    },
    async disconnectSite(id: string) {
      try {
        await disconnect.mutateAsync({ id, body: { disconnect: true } });
        return true;
      } catch {
        toast.error(tw('updateFailed'));
        return false;
      }
    },
  };
}
