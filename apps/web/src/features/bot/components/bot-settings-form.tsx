import type { BotDto } from '@agent-sales/contracts';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { errorMessage } from '@/lib/errors';

import { useReadiness, useUpdateBot } from '../api/bots';
import { changedFields, type SettingsDraft, settingsProblems } from '../utils/settings-draft';
import { BotSettingsAdvanced } from './bot-settings-advanced';
import { BotSettingsBasic } from './bot-settings-basic';

/**
 * "Thiết lập Bot": basic identity and behaviour on the first tab, the bot's
 * conversation details on the second. Only changed fields are sent; the save
 * bar appears when the draft differs from the saved bot.
 */
export function BotSettingsForm({ bot }: { bot: BotDto }) {
  const { t } = useTranslation();
  const { t: training } = useTranslation('training');
  const update = useUpdateBot(bot.id);
  const readiness = useReadiness(bot.id);
  const initial: SettingsDraft = useMemo(() => ({ name: bot.name, settings: bot.settings }), [bot]);
  const [draft, setDraft] = useState<SettingsDraft>(initial);

  const placeholderKeys = useMemo(
    () =>
      [
        ...new Set([
          ...(readiness.data?.missingPlaceholders ?? []),
          ...Object.keys(bot.settings.placeholders),
        ]),
      ].sort((a, b) => a.localeCompare(b)),
    [readiness.data, bot.settings.placeholders],
  );

  const changed = useMemo(() => changedFields(draft, initial), [draft, initial]);
  const problems = useMemo(() => settingsProblems(draft), [draft]);
  const dirty = Object.keys(changed).length > 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    if (problems.length) {
      toast.error(training('space.settings.fixErrors'));
      return;
    }
    update.mutate(changed, {
      onSuccess: (saved) => {
        setDraft({ name: saved.name, settings: saved.settings });
        toast.success(t('settings.saved'));
      },
      onError: (err) => toast.error(errorMessage(t, err)),
    });
  }

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-24">
      <header>
        <h1 className="text-lg font-semibold">{training('space.settings.title')}</h1>
        <p className="text-sm text-muted-foreground">{training('space.settings.subtitle')}</p>
      </header>

      <Tabs defaultValue="basic" className="gap-6">
        <TabsList variant="line" className="w-full justify-start border-b">
          <TabsTrigger value="basic" className="flex-none px-1 data-active:text-primary">
            {training('space.settings.basic')}
          </TabsTrigger>
          <TabsTrigger value="advanced" className="flex-none px-1 data-active:text-primary">
            {training('space.settings.advanced')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="basic">
          <BotSettingsBasic draft={draft} problems={problems} update={setDraft} />
        </TabsContent>
        <TabsContent value="advanced">
          <BotSettingsAdvanced draft={draft} placeholderKeys={placeholderKeys} update={setDraft} />
        </TabsContent>
      </Tabs>

      {dirty ? (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-xl border bg-background/95 px-4 py-3 shadow-lg backdrop-blur animate-in fade-in slide-in-from-bottom-2">
          <span className="text-sm text-muted-foreground">{t('settings.unsaved')}</span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setDraft(initial)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending ? t('settings.saving') : t('settings.save')}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
