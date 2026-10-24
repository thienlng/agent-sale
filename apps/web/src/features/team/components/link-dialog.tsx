import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** An invitation link shown once, to copy and send. */
export function LinkDialog({
  link,
  title,
  onClose,
}: {
  link: string | null;
  title: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [link]);
  const copy = () => {
    if (!link) return;
    void navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      toast.success(t('team.copied'));
    });
  };
  return (
    <Dialog open={link !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('team.linkOnce')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-link">{t('team.link')}</Label>
          <div className="flex gap-2">
            <Input
              id="invite-link"
              readOnly
              value={link ?? ''}
              onFocus={(e) => e.target.select()}
            />
            <Button type="button" variant="outline" onClick={copy}>
              {copied ? <Check /> : <Copy />}
              {t('team.copy')}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t('team.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
