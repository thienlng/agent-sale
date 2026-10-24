import type { FaqDto, ImportFaqsRequest } from '@agent-sales/contracts';
import { Download, Upload } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorMessage } from '@/lib/errors';
import { useImportFaqs } from '../api/faqs';
import { downloadFaqCsv, MAX_FAQ_CSV_BYTES, parseFaqCsv } from '../utils/faq-csv';

export function FaqTransfer({ botId, faqs }: { botId: string; faqs: FaqDto[] | undefined }) {
  const { t } = useTranslation('training');
  const { t: common } = useTranslation();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ImportFaqsRequest['items']>([]);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const importer = useImportFaqs(botId);
  async function readFile(file: File | undefined) {
    setItems([]);
    setError('');
    if (!file) return;
    if (file.size > MAX_FAQ_CSV_BYTES) {
      setError(t('csvErrors.size'));
      return;
    }
    setReading(true);
    try {
      const result = parseFaqCsv(await file.text());
      if (result.ok) setItems(result.items);
      else setError(t(`csvErrors.${result.reason}`, { row: result.row ?? '' }));
    } catch {
      setError(t('csvErrors.format'));
    } finally {
      setReading(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setItems([]);
          setError('');
          setOpen(true);
        }}
      >
        <Upload />
        {t('importCsv')}
      </Button>
      <Button
        variant="outline"
        disabled={!faqs?.length}
        onClick={() => downloadFaqCsv(faqs ?? [], `bot-${botId}-faqs.csv`)}
      >
        <Download />
        {t('exportCsv')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!importer.isPending) setOpen(next);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('importCsv')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('csvFormat')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadFaqCsv(
                [
                  {
                    question: 'What are your opening hours?',
                    answer: 'Monday to Friday, 9am to 5pm.',
                  },
                ],
                'faq-template.csv',
              )
            }
          >
            {t('downloadTemplate')}
          </Button>
          <div className="space-y-2">
            <Label htmlFor="faq-csv-file">{t('csvFile')}</Label>
            <Input
              id="faq-csv-file"
              type="file"
              accept=".csv,text/csv"
              disabled={reading || importer.isPending}
              onChange={(event) => void readFile(event.target.files?.[0])}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {items.length ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('csvPreview', { count: items.length })}</p>
              <ul className="max-h-52 divide-y overflow-y-auto rounded-md border">
                {items.slice(0, 5).map((item, index) => (
                  <li key={index} className="p-3">
                    <p className="break-words text-sm font-medium">{item.question}</p>
                    <p className="line-clamp-2 break-words whitespace-pre-wrap text-xs text-muted-foreground">
                      {item.answer}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={importer.isPending} onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              disabled={!items.length || reading || importer.isPending}
              onClick={() =>
                importer.mutate(
                  { items },
                  {
                    onSuccess: () => {
                      toast.success(t('csvImported', { count: items.length }));
                      setOpen(false);
                    },
                    onError: (reason) => toast.error(errorMessage(common, reason)),
                  },
                )
              }
            >
              {t('confirmImport')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
