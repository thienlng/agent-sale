import type { BotDto } from '@agent-sales/contracts';
import { Braces, Copy, Monitor } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import {
  type AdsMessageDraft,
  type AdsMessageType,
  adsMessageProblems,
  buildAdsMessage,
  emptyAdsDraft,
} from '../utils/ads-message';
import { AdsMessageForm } from './ads-message-form';
import { AdsPreview } from './ads-preview';

const TYPES: AdsMessageType[] = ['text', 'quick_replies', 'image_buttons'];

/**
 * "Tool Ads Facebook": builds the JSON of a Click-to-Messenger ad's message
 * template, with a Messenger preview and the code to paste into Ads Manager.
 */
export function AdsTool({ bot }: { bot: BotDto }) {
  const { t } = useTranslation('training');
  const [draft, setDraft] = useState<AdsMessageDraft | null>(null);
  const problems = useMemo(() => (draft ? adsMessageProblems(draft) : []), [draft]);
  const json = useMemo(
    () => (draft ? JSON.stringify(buildAdsMessage(draft), null, 2) : ''),
    [draft],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(json);
      toast.success(t('space.ads.copied'));
    } catch {
      toast.error(t('space.ads.copyFailed'));
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="border-b pb-4">
        <h1 className="text-lg font-semibold">{t('space.ads.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('space.ads.subtitle')}</p>
      </header>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ads-type">
              {t('space.ads.type')} <span className="text-destructive">*</span>
            </Label>
            <Select
              value={draft?.type ?? ''}
              onValueChange={(type) => setDraft(emptyAdsDraft(type as AdsMessageType))}
            >
              <SelectTrigger id="ads-type" className="h-10 w-full">
                <SelectValue placeholder={t('space.ads.typePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`space.ads.types.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {draft ? (
            <AdsMessageForm
              draft={draft}
              problems={problems}
              update={(change) => setDraft((d) => (d ? { ...d, ...change } : d))}
            />
          ) : null}
        </div>

        <Tabs defaultValue="preview" className="min-w-0 gap-3">
          <TabsList className="h-10">
            <TabsTrigger value="preview" className="px-4">
              <Monitor />
              {t('space.ads.preview')}
            </TabsTrigger>
            <TabsTrigger value="code" className="px-4">
              <Braces />
              {t('space.ads.code')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="preview" className="rounded-xl border p-6">
            <AdsPreview botName={bot.name} themeColor={bot.settings.themeColor} draft={draft} />
          </TabsContent>
          <TabsContent value="code" className="flex flex-col gap-3 rounded-xl border p-4">
            {draft ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {problems.length ? t('space.ads.codeIncomplete') : t('space.ads.codeHint')}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
                    <Copy />
                    {t('space.ads.copy')}
                  </Button>
                </div>
                <pre className="max-h-[480px] overflow-auto rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed">
                  <code>{json}</code>
                </pre>
              </>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t('space.ads.chooseType')}
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
