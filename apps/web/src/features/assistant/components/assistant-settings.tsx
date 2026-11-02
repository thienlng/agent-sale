import type { AssistantToolsetDto, AssistantToolsetId } from '@agent-sales/contracts';
import { Brain, ChevronRight } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';

import { useAssistantSettings, useUpdateAssistantSettings } from '../api/assistant-settings';

function ToolsetRow({
  toolset,
  enabled,
  busy,
  onToggle,
}: {
  toolset: AssistantToolsetDto;
  enabled: boolean;
  busy: boolean;
  onToggle: (on: boolean) => void;
}) {
  const { t } = useTranslation('assistant');
  const id = useId();
  return (
    <li className="flex items-center gap-3 py-2">
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{t(toolset.labelKey)}</span>
        <span className="block text-xs text-muted-foreground">
          {toolset.locked
            ? t('settings.locked', { count: toolset.uses30d })
            : t('settings.uses', { count: toolset.uses30d })}
        </span>
      </label>
      <Switch
        id={id}
        checked={enabled}
        disabled={toolset.locked || busy}
        onCheckedChange={onToggle}
      />
    </li>
  );
}

/** "Cài đặt trợ lý": background review on/off, the toolsets, and the way to the memory view. */
export function AssistantSettings({ onOpenMemory }: { onOpenMemory: () => void }) {
  const { t } = useTranslation('assistant');
  const settings = useAssistantSettings();
  const update = useUpdateAssistantSettings();
  const reviewId = useId();
  const onError = { onError: () => toast.error(t('settings.saveError')) };

  function toggleToolset(id: AssistantToolsetId, on: boolean): void {
    const disabled = new Set(settings.data?.disabledToolsets ?? []);
    if (on) disabled.delete(id);
    else disabled.add(id);
    update.mutate({ disabledToolsets: [...disabled].sort() }, onError);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
      <h2 className="font-semibold">{t('settings.title')}</h2>
      {settings.isPending ? (
        <div className="mt-4 flex flex-col gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-32" />
        </div>
      ) : settings.isError ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {t('loadError')}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          <div className="flex items-center gap-3 rounded-lg border px-3 py-2">
            <label htmlFor={reviewId} className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{t('settings.review')}</span>
              <span className="block text-xs text-muted-foreground">
                {t('settings.reviewHint')}
              </span>
            </label>
            <Switch
              id={reviewId}
              checked={settings.data.reviewEnabled}
              disabled={update.isPending}
              onCheckedChange={(on) => update.mutate({ reviewEnabled: on }, onError)}
            />
          </div>
          <section aria-label={t('settings.toolsets')}>
            <h3 className="text-sm font-semibold">{t('settings.toolsets')}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t('settings.toolsetsHint')}</p>
            <ul className="mt-2 divide-y">
              {settings.data.toolsets.map((toolset) => (
                <ToolsetRow
                  key={toolset.id}
                  toolset={toolset}
                  enabled={!settings.data.disabledToolsets.includes(toolset.id)}
                  busy={update.isPending}
                  onToggle={(on) => toggleToolset(toolset.id, on)}
                />
              ))}
            </ul>
          </section>
          <button
            type="button"
            onClick={onOpenMemory}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Brain className="size-4 text-muted-foreground" aria-hidden />
            <span className="flex-1">{t('showMemory')}</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
