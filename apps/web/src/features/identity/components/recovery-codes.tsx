import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';

/** The one moment the recovery codes are visible: copy, download, then confirm they are saved. */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const text = codes.join('\n');

  function download() {
    const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rapiz-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('wsettings.security.codesHint')}</p>
      <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void navigator.clipboard?.writeText(text)}
        >
          {t('wsettings.security.copy')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          {t('wsettings.security.downloadCodes')}
        </Button>
      </div>
      <DialogFooter>
        <Button type="button" onClick={onDone}>
          {t('wsettings.security.codesDone')}
        </Button>
      </DialogFooter>
    </div>
  );
}
