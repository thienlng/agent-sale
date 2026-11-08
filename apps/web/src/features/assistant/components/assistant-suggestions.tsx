import type { AssistantSuggestionDto } from '@agent-sales/contracts';
import { useRouter } from '@tanstack/react-router';
import { ChevronDown, Lightbulb } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { useAssistantSuggestions, useDecideSuggestion } from '../api/assistant-settings';
import { useAssistantUi } from '../stores/assistant-ui.store';
import { safeAppPath } from '@/lib/safe-app-path';

/** The skill a `skill` card would draft, when its payload has one. */
function draftOf(
  suggestion: AssistantSuggestionDto,
): { name: string; description: string; body: string } | null {
  if (suggestion.kind !== 'skill') return null;
  const { name, description, body } = suggestion.payload;
  if (typeof name !== 'string' || typeof body !== 'string') return null;
  return { name, description: typeof description === 'string' ? description : '', body };
}

/**
 * What a `skill` card would save, before the owner accepts: name, description and the body
 * (collapsed). Accepting only drafts it; the owner still approves it under Skills.
 */
function SkillDraft({ draft }: { draft: { name: string; description: string; body: string } }) {
  const { t } = useTranslation('assistant');
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1 pl-6">
      <p className="text-xs break-words">
        <span className="font-medium">{draft.name}</span>
        {draft.description ? (
          <span className="text-muted-foreground"> — {draft.description}</span>
        ) : null}
      </p>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {open ? t('skills.hideBody') : t('skills.showBody')}
        <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <pre className="max-h-32 overflow-y-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
          {draft.body}
        </pre>
      ) : null}
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: AssistantSuggestionDto }) {
  const { t } = useTranslation('assistant');
  const router = useRouter();
  const decide = useDecideSuggestion();
  const draft = draftOf(suggestion);

  function accept(): void {
    decide.mutate(
      { id: suggestion.id, decision: 'accept' },
      {
        onSuccess: (res) => {
          if (res.skill) toast.success(t('suggestions.skillSaved', { name: res.skill.name }));
          // A schedule card opens its draft in the schedule editor; saving it is the approval.
          if (res.scheduleDraft) useAssistantUi.getState().openScheduleEditor(res.scheduleDraft);
          // The server checked the path already; the web checks again before leaving the page.
          const to = res.path ? safeAppPath(res.path) : null;
          if (to) void router.navigate({ href: to });
        },
        onError: (error) =>
          toast.error(
            error instanceof ApiClientError && error.status === 409
              ? t('suggestions.conflict')
              : error instanceof ApiClientError &&
                  error.details?.['reason'] === 'invalid_schedule_draft'
                ? t('suggestions.invalidSchedule')
                : t('suggestions.error'),
          ),
      },
    );
  }

  return (
    <li className="flex flex-col gap-1 rounded-lg border bg-background px-3 py-2">
      <div className="flex items-center gap-2">
        <Lightbulb className="size-4 shrink-0 text-brand-text" aria-hidden />
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
      </div>
      {draft ? <SkillDraft draft={draft} /> : null}
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
