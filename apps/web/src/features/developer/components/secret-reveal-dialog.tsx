import { Check, Copy, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Shows a credential the server returns once (an API key, a webhook signing secret). It lives only
 * in this dialog's props: closing it drops the value for good.
 */
export function SecretRevealDialog({
  value,
  title,
  warning,
  done,
  onClose,
}: {
  value: string | null;
  title: string;
  warning: string;
  done: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('developer');
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog
      open={value !== null}
      onOpenChange={(open) => {
        if (open) return;
        setCopied(false);
        onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{warning}</DialogDescription>
        </DialogHeader>
        <Alert>
          <TriangleAlert />
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
        <div className="flex items-center gap-2">
          <code
            data-testid="revealed-secret"
            className="min-w-0 flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-sm break-all select-all"
          >
            {value}
          </code>
          <Button type="button" variant="outline" onClick={() => void copy()}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied ? t('common.copied') : t('common.copy')}
          </Button>
        </div>
        <DialogFooter>
          <Button
            type="button"
            onClick={() => {
              setCopied(false);
              onClose();
            }}
          >
            {done}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
