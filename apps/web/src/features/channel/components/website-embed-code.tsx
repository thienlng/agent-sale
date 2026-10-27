import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { widgetUrl } from '@/lib/env';
import { embedCode } from '../lib/website';

/** Copies the embed snippet; resolves true on success. */
export async function copyEmbedCode(siteKey: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(embedCode(siteKey, widgetUrl()));
    return true;
  } catch {
    return false;
  }
}

/** Copy action with "Đã chép" feedback; shared by the card (icon) and the install dialog. */
export function useCopyEmbed(siteKey: string) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    if (await copyEmbedCode(siteKey)) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(t('channelInbox.integrations.website.copyFailed'));
    }
  }
  return { copied, copy };
}

export function WebsiteEmbedCode({ siteKey }: { siteKey: string }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopyEmbed(siteKey);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('channelInbox.integrations.website.embedLabel')}</p>
      <pre
        aria-label={t('channelInbox.integrations.website.embedLabel')}
        className="overflow-x-auto rounded-lg border bg-muted/60 p-3 text-xs"
      >
        <code>{embedCode(siteKey, widgetUrl())}</code>
      </pre>
      <Button variant="outline" size="sm" onClick={() => void copy()}>
        {copied ? <Check /> : <Copy />}
        {copied
          ? t('channelInbox.integrations.website.copied')
          : t('channelInbox.integrations.website.copyCode')}
      </Button>
    </div>
  );
}
