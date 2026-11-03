import type { AssistantLearningItemDto } from '@agent-sales/contracts';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  useAssistantLearning,
  useUndoLearnedMemory,
  useUndoSkillEvent,
} from '../api/assistant-skills';

/** At most this many notices show; older ones stay reachable in the skills and memory views. */
const MAX_NOTICES = 3;

/** The feed is the owner's (not a business's), so one key per browser. */
const SEEN_KEY = 'rapiz.assistant.learningSeen';

/** The newest notice the owner closed (a per-viewer convenience only). */
function readSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeen(at: string): void {
  try {
    localStorage.setItem(SEEN_KEY, at);
  } catch {
    // Storage blocked: the notices simply show again next time.
  }
}

function itemKey(item: AssistantLearningItemDto): string {
  return item.kind === 'skill' ? item.skillEventId : `${item.store}/${item.entryId}`;
}

/** The notice's wording: what was learned, or what the curator put away. */
function useNoticeText(item: AssistantLearningItemDto): string {
  const { t } = useTranslation('assistant');
  if (item.kind === 'memory')
    return item.previousText === null
      ? t('learning.memory', { text: item.text })
      : t('learning.memoryRewritten', { text: item.text, previous: item.previousText });
  if (item.actor === 'curator')
    return item.state === 'stale'
      ? t('learning.stale', { name: item.name })
      : t('learning.archived', { name: item.name });
  if (item.action === 'create') return t('learning.newSkill', { name: item.name });
  return t('learning.patchedSkill', { name: item.name });
}

function LearningNotice({
  item,
  onOpenSkills,
}: {
  item: AssistantLearningItemDto;
  onOpenSkills: () => void;
}) {
  const { t } = useTranslation('assistant');
  const text = useNoticeText(item);
  const undoSkill = useUndoSkillEvent();
  const undoMemory = useUndoLearnedMemory();
  const busy = undoSkill.isPending || undoMemory.isPending;
  const options = {
    onSuccess: () => toast.success(t('learning.undone')),
    onError: () => toast.error(t('learning.undoError')),
  };
  function undo(): void {
    if (item.kind === 'skill') undoSkill.mutate(item.skillEventId, options);
    else undoMemory.mutate({ store: item.store, entryId: item.entryId }, options);
  }
  return (
    <li className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate" title={text}>
        {text}
      </span>
      {item.kind === 'skill' && item.state === 'pending_approval' ? (
        <button
          type="button"
          className="shrink-0 font-medium text-primary hover:underline"
          onClick={onOpenSkills}
        >
          {t('learning.view')}
        </button>
      ) : null}
      <button
        type="button"
        className="shrink-0 font-medium hover:text-foreground hover:underline disabled:opacity-50"
        disabled={busy}
        onClick={undo}
      >
        {t('learning.undo')}
      </button>
    </li>
  );
}

/**
 * Whether a notice still says something true with an undo that means something. A skill change
 * that was undone is gone; so is a review's "vừa học / vừa cập nhật" once the skill is archived
 * or deleted, however it got there (N4b). The curator's own archive notices stay.
 */
function isLive(item: AssistantLearningItemDto): boolean {
  if (item.kind !== 'skill') return true;
  if (item.undone) return false;
  return item.actor !== 'review' || (item.state !== 'archived' && item.state !== null);
}

/**
 * "💡 Trợ lý vừa học": one quiet line per recent change of the background review or the curator,
 * under the panel header, each with its undo. Closing hides what is shown until something newer.
 */
export function AssistantLearning({ onOpenSkills }: { onOpenSkills: () => void }) {
  const { t } = useTranslation('assistant');
  const learning = useAssistantLearning();
  const [seen, setSeen] = useState(readSeen);
  const items = (learning.data ?? [])
    .filter(isLive)
    .filter((item) => !seen || Date.parse(item.at) > Date.parse(seen))
    .slice(0, MAX_NOTICES);
  if (!items.length) return null;

  function close(): void {
    const newest = items[0]?.at;
    if (!newest) return;
    writeSeen(newest);
    setSeen(newest);
  }

  return (
    <section
      aria-label={t('learning.label')}
      className="flex items-start gap-2 border-b bg-muted/40 py-2 pr-2 pl-4"
    >
      <ul className="flex min-w-0 flex-1 flex-col gap-1">
        {items.map((item) => (
          <LearningNotice key={itemKey(item)} item={item} onOpenSkills={onOpenSkills} />
        ))}
      </ul>
      <button
        type="button"
        aria-label={t('learning.close')}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
        onClick={close}
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </section>
  );
}
