import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { WebsiteEmbedCode } from './website-embed-code';
import { WebsiteInstallGuide } from './website-install-guide';

export function WebsiteInstallDialog({
  name,
  siteKey,
  onClose,
}: {
  name: string;
  siteKey: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('channelInbox.integrations.website.installTitle', { name })}</DialogTitle>
          <DialogDescription>
            {t('channelInbox.integrations.website.installBody')}
          </DialogDescription>
        </DialogHeader>
        <WebsiteEmbedCode siteKey={siteKey} />
        <WebsiteInstallGuide />
      </DialogContent>
    </Dialog>
  );
}
