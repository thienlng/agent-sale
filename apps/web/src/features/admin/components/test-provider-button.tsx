import type { LlmProviderDto } from '@agent-sales/contracts';
import { Plug } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { errorMessage } from '@/lib/errors';

import { useLlmTiers, useProviderModels, useTestProvider } from '../api/llm';
import { ModelPicker } from './model-picker';

type TestMutation = ReturnType<typeof useTestProvider>;

function TestForm({ provider, test }: { provider: LlmProviderDto; test: TestMutation }) {
  const { t } = useTranslation();
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
    if (!model) return;
    test.mutate(
      { id: provider.id, model },
      {
        onSuccess: (res) =>
          res.ok
            ? toast.success(resultText(res))
            : toast.error(t('admin.testFail', { error: res.error })),
        onError: (err) => toast.error(errorMessage(t, err)),
      },
    );
  }

  function resultText(res: { model: string | null; latencyMs: number }) {
    return t('admin.testOk', {
      model: res.model ?? model,
      seconds: (res.latencyMs / 1000).toFixed(1),
    });
  }

  function pick(next: string) {
    setPicked(next);
    test.reset(); // a result belongs to the model it was run with
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
            onChange={pick}
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
          {test.data.ok ? '✓ ' : ''}
          {test.data.ok ? resultText(test.data) : t('admin.testFail', { error: test.data.error })}
        </p>
      ) : test.isError ? (
        <p role="status" className="text-sm break-words text-destructive">
          {errorMessage(t, test.error)}
        </p>
      ) : null}
    </form>
  );
}

/** Sends a tiny prompt with the stored key; the result stays inline in the popover (and toasts). */
export function TestProviderButton({ provider }: { provider: LlmProviderDto }) {
  const { t } = useTranslation();
  // Owned here, not in the popover, so the last result is still there when it is reopened.
  const test = useTestProvider();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Plug />
          {t('admin.test')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <TestForm provider={provider} test={test} />
      </PopoverContent>
    </Popover>
  );
}
