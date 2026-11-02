import type { AssistantSuggestionDto } from '@agent-sales/contracts';
import { useRouter } from '@tanstack/react-router';
import { Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api-client';

import { useAssistantSuggestions, useDecideSuggestion } from '../api/assistant-settings';
import { safeAppPath } from '../utils/safe-app-path';

function SuggestionCard({ suggestion }: { suggestion: AssistantSuggestionDto }) {
  const { t } = useTranslation('assistant');
  const router = useRouter();
  const decide = useDecideSuggestion();

  function accept(): void {
    decide.mutate(
      { id: suggestion.id, decision: 'accept' },
      {
        onSuccess: (res) => {
          if (res.skill) toast.success(t('suggestions.skillSaved', { name: res.skill.name }));
          // The server checked the path already; the web checks again before leaving the page.
          const to = res.path ? safeAppPath(res.path) : null;
          if (to) void router.navigate({ href: to });
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiClientError && error.status === 409
              ? t('suggestions.conflict')
              : t('suggestions.error'),
          ),
      },
    );
  }

  return (
    <li className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
      <Lightbulb className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1 text-sm break-words">{suggestion.title}</span>
      <Button size="sm" disabled={decide.isPending} onClick={accept}>
        {t('suggestions.accept')}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={decide.isPending}
        onClick={() =>
          decide.mutate(
            { id: suggestion.id, decision: 'dismiss' },
            { onError: () => toast.error(t('suggestions.error')) },
          )
        }
      >
        {t('suggestions.dismiss')}
      </Button>
    </li>
  );
}

/** The review's pending suggestions, as small cards above the composer. */
export function AssistantSuggestions() {
  const { t } = useTranslation('assistant');
  const suggestions = useAssistantSuggestions();
  const items = suggestions.data ?? [];
  if (!items.length) return null;
  return (
    <section aria-label={t('suggestions.label')} className="max-h-40 overflow-y-auto px-4 pt-2">
      <ul className="flex flex-col gap-2">
        {items.map((s) => (
          <SuggestionCard key={s.id} suggestion={s} />
        ))}
      </ul>
    </section>
  );
}
