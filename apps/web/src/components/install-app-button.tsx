import { Download, Share } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { isIos, isStandalone, useInstallPrompt } from '@/lib/pwa';

/**
 * "Cài ứng dụng" (T-190): Chrome, Edge and Android get their own install prompt; on iPhone and
 * iPad, where Safari has none, it shows how to add Rapiz to the home screen. Hidden inside the
 * installed app and wherever the browser offers no install.
 */
export function InstallAppButton() {
  const { t } = useTranslation();
  const { available, install } = useInstallPrompt();
  const [help, setHelp] = useState(false);
  if (isStandalone()) return null;
  const ios = isIos();
  if (!available && !ios) return null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 gap-1 px-2 text-xs"
        title={t('pwa.install.hint')}
        onClick={() => (ios ? setHelp(true) : void install())}
      >
        <Download className="size-4" aria-hidden />
        <span className="hidden sm:inline">{t('pwa.install.button')}</span>
      </Button>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('pwa.install.iosTitle')}</DialogTitle>
            <DialogDescription>{t('pwa.install.iosIntro')}</DialogDescription>
          </DialogHeader>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
            <li>
              {t('pwa.install.iosStep1')}{' '}
              <Share
                className="inline size-4 align-text-bottom"
                aria-label={t('pwa.install.share')}
              />
            </li>
            <li>{t('pwa.install.iosStep2')}</li>
            <li>{t('pwa.install.iosStep3')}</li>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
