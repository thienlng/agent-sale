import type { LlmProviderDto } from '@agent-sales/contracts';
import { Plug } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { useLlmTiers, useProviderModels, useTestProvider } from '../api/llm';
import { ModelPicker } from './model-picker';

function TestForm({ provider }: { provider: LlmProviderDto }) {
  const { t } = useTranslation();
  const test = useTestProvider();
  const models = useProviderModels(provider.id);
  const tiers = useLlmTiers();
  const [picked, setPicked] = useState<string | null>(null);

  // Default: the model already routed for this provider, else the first listed one.
  const routed = tiers.data
    ?.flatMap((r) => [r.primary, r.fallback])
    .find((target) => target?.providerId === provider.id)?.model;
  const model = (picked ?? routed ?? models.data?.data[0]?.id ?? '').trim();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (model) test.mutate({ id: provider.id, model });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="text-sm font-medium" htmlFor={`test-${provider.id}`}>
        {t('admin.testModel')}
      </label>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <ModelPicker
            id={`test-${provider.id}`}
            providerId={provider.id}
            label={t('admin.testModel')}
            value={model}
            onChange={setPicked}
          />
        </div>
        <Button type="submit" disabled={!model || test.isPending}>
          {t('admin.test')}
        </Button>
      </div>
      {test.data ? (
        <p
          role="status"
          className={test.data.ok ? 'text-sm text-success' : 'text-sm break-words text-destructive'}
        >
          {test.data.ok
            ? t('admin.testOk', { model: test.data.model, ms: test.data.latencyMs })
            : t('admin.testFail', { error: test.data.error })}
        </p>
      ) : null}
    </form>
  );
}

/** Sends a tiny prompt with the stored key; the result shows inline. */
export function TestProviderButton({ provider }: { provider: LlmProviderDto }) {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Plug />
          {t('admin.test')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <TestForm provider={provider} />
      </PopoverContent>
    </Popover>
  );
}
