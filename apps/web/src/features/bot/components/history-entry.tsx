import type { TrainingChange, TrainingHistoryDto } from '@agent-sales/contracts';
import { format } from 'date-fns';
import { Bot, ChevronDown, Pencil, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

import {
  ACTION_VERB,
  describeValue,
  fieldLabelKey,
  profileChanges,
  SECTION_KEY,
  type ValueView,
} from '../utils/history';

function Value({ view }: { view: ValueView }) {
  const { t } = useTranslation('training');
  switch (view.type) {
    case 'empty':
      return <span className="text-muted-foreground italic">{t('space.history.empty')}</span>;
    case 'onOff':
      return <b>{view.on ? t('space.history.on') : t('space.history.off')}</b>;
    case 'color':
      return (
        <b className="inline-flex items-center gap-1 align-middle">
          <span
            aria-hidden
            className="inline-block size-3.5 rounded-sm border"
            style={{ backgroundColor: view.value }}
          />
          {view.value}
        </b>
      );
    case 'option':
      return <b>{t(view.key)}</b>;
    case 'schedule':
      return (
        <b>
          {view.mode === 'always'
            ? t('space.settings.scheduleOptions.always')
            : t('space.history.scheduleRange', { start: view.start, end: view.end })}
        </b>
      );
    case 'text':
      return <b className="break-words">{view.text}</b>;
  }
}

function ChangeRow({
  label,
  before,
  after,
}: {
  label: string;
  before: ValueView;
  after: ValueView;
}) {
  const { t } = useTranslation('training');
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
        <Pencil aria-hidden className="size-3.5" />
      </span>
      <p className="min-w-0 text-sm">
        <span className="font-medium text-primary">{t('space.history.editVerb')}</span> {label}{' '}
        <Value view={before} />
        <span aria-label={t('space.history.to')}> → </span>
        <Value view={after} />
      </p>
    </li>
  );
}

function ChangeLine({ change }: { change: TrainingChange }) {
  const { t } = useTranslation('training');
  if (change.field === 'profile')
    // One line per changed profile field, never one opaque object.
    return (
      <>
        {profileChanges(change.before, change.after).map((c) => (
          <ChangeRow
            key={c.key}
            label={c.isNotes ? t('profile.groups.notes') : t(`profile.fields.${c.key}`, c.key)}
            before={describeValue(c.key, c.before)}
            after={describeValue(c.key, c.after)}
          />
        ))}
      </>
    );
  const labelKey = fieldLabelKey(change.field);
  return (
    <ChangeRow
      label={labelKey ? t(labelKey) : change.field}
      before={describeValue(change.field, change.before)}
      after={describeValue(change.field, change.after)}
    />
  );
}

/** One timeline row: who did what, when, and the field-by-field detail. */
export function HistoryEntry({
  entry,
  onRestore,
}: {
  entry: TrainingHistoryDto;
  onRestore: (entry: TrainingHistoryDto) => void;
}) {
  const { t } = useTranslation('training');
  const [open, setOpen] = useState(true);
  const actor = entry.actor.trim();
  const hasDetail = entry.changes.length > 0 || entry.restorable;

  return (
    <li className="group relative flex gap-3 pb-6 last:pb-0">
      <span
        aria-hidden
        className="absolute top-10 bottom-0 left-[18px] w-px bg-border group-last:hidden"
      />
      <span
        aria-hidden
        className="z-[1] grid size-9 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
      >
        {actor ? actor.charAt(0).toUpperCase() : <Bot className="size-4" />}
      </span>
      <Collapsible open={open} onOpenChange={setOpen} className="min-w-0 flex-1">
        <div className="flex items-start gap-1">
          <p className="min-w-0 text-sm">
            <b>{actor || t('space.history.system')}</b>{' '}
            {t(`space.history.verbs.${ACTION_VERB[entry.action]}`)}{' '}
            <b>{t(`space.history.sections.${SECTION_KEY[entry.kind]}`)}</b>{' '}
            <span className="break-words">{entry.title}</span>
          </p>
          {hasDetail ? (
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={open ? t('space.history.collapse') : t('space.history.expand')}
              >
                <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
              </Button>
            </CollapsibleTrigger>
          ) : null}
        </div>
        <time dateTime={entry.createdAt} className="mt-0.5 block text-xs text-muted-foreground">
          {format(new Date(entry.createdAt), 'dd/MM/yyyy - hh:mm a')}
        </time>
        {hasDetail ? (
          <CollapsibleContent className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            {entry.changes.length ? (
              <ul className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg border bg-background p-3">
                {entry.changes.map((change) => (
                  <ChangeLine key={change.field} change={change} />
                ))}
              </ul>
            ) : null}
            {entry.restorable ? (
              <Button
                className="shrink-0 self-start sm:self-center"
                onClick={() => onRestore(entry)}
              >
                <Undo2 />
                {t('space.history.restore')}
              </Button>
            ) : null}
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </li>
  );
}
