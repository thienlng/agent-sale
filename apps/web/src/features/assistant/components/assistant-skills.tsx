import type { AssistantSkillSummaryDto } from '@agent-sales/contracts';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useAssistantSkill, useAssistantSkills, useSkillAction } from '../api/assistant-skills';
import { AssistantSkillEditor } from './assistant-skill-editor';
import { useSkillErrorToast } from './skill-errors';

interface SkillSections {
  pending: AssistantSkillSummaryDto[];
  owner: AssistantSkillSummaryDto[];
  learned: AssistantSkillSummaryDto[];
  platform: AssistantSkillSummaryDto[];
  archived: AssistantSkillSummaryDto[];
}

/**
 * The page's sections. A platform skill the owner customised shows as its shadow, in place.
 * Archived shadows are left out: "Khôi phục bản gốc" archives them, and "Tinh chỉnh" makes a
 * fresh one, so they would only pile up.
 */
function sectionsOf(items: readonly AssistantSkillSummaryDto[]): SkillSections {
  const shadows = new Map(
    items
      .filter((s) => s.provenance === 'shadow' && s.state !== 'archived')
      .map((s) => [s.shadowOf, s]),
  );
  const sections: SkillSections = {
    pending: [],
    owner: [],
    learned: [],
    platform: [],
    archived: [],
  };
  for (const skill of items) {
    if (skill.provenance === 'platform') {
      sections.platform.push((skill.shadowed && shadows.get(skill.name)) || skill);
    } else if (skill.provenance === 'shadow') {
      continue;
    } else if (skill.state === 'archived') {
      sections.archived.push(skill);
    } else if (skill.state === 'pending_approval') {
      sections.pending.push(skill);
    } else {
      sections[skill.provenance].push(skill);
    }
  }
  return sections;
}

/** A learned skill waiting for the owner: one tap to approve or drop, the body on demand. */
function PendingSkillCard({ skill }: { skill: AssistantSkillSummaryDto }) {
  const { t } = useTranslation('assistant');
  const [open, setOpen] = useState(false);
  const detail = useAssistantSkill(open ? skill.ref : null);
  const action = useSkillAction();
  const onError = useSkillErrorToast();
  const skillId = skill.id ?? '';
  // The version on screen: the opened body's, else the list row's (a newer one answers 409).
  const expectedUpdatedAt = detail.data?.updatedAt ?? skill.updatedAt;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary-soft/40 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium break-words">{skill.name}</p>
        <p className="text-xs text-muted-foreground break-words">{skill.description}</p>
      </div>
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
        detail.data ? (
          <pre className="max-h-48 overflow-y-auto rounded bg-background p-2 text-xs whitespace-pre-wrap">
            {detail.data.body}
          </pre>
        ) : (
          <Skeleton className="h-12" />
        )
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={action.isPending}
          onClick={() =>
            action.mutate(
              { skillId, action: 'approve', expectedUpdatedAt },
              { onSuccess: () => toast.success(t('skills.approved')), onError },
            )
          }
        >
          {t('skills.approve')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={action.isPending}
          onClick={() =>
            action.mutate({ skillId, action: 'reject', expectedUpdatedAt }, { onError })
          }
        >
          {t('skills.reject')}
        </Button>
      </div>
    </li>
  );
}

function SkillRow({
  skill,
  onOpen,
}: {
  skill: AssistantSkillSummaryDto;
  onOpen: (ref: string) => void;
}) {
  const { t } = useTranslation('assistant');
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(skill.ref)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-offset-3 focus-visible:ring-offset-background focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{skill.title ?? skill.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {skill.descriptionVi ?? skill.description}
          </span>
        </span>
        {skill.provenance === 'shadow' ? (
          <span className="shrink-0 text-xs text-brand-text">{t('skills.customised')}</span>
        ) : skill.state === 'stale' ? (
          <span className="shrink-0 text-xs text-muted-foreground">{t('skills.stale')}</span>
        ) : null}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </li>
  );
}

function Section({
  title,
  skills,
  empty,
  onOpen,
}: {
  title: string;
  skills: AssistantSkillSummaryDto[];
  empty?: string;
  onOpen: (ref: string) => void;
}) {
  if (!skills.length && !empty) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">{title}</h3>
      {skills.length ? (
        <ul className="-mx-2 flex flex-col">
          {skills.map((skill) => (
            <SkillRow key={skill.ref} skill={skill} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

/** "Kỹ năng": what the assistant knows how to do, by origin, each with an editor and its ledger. */
export function AssistantSkills() {
  const { t } = useTranslation('assistant');
  const skills = useAssistantSkills();
  const [openRef, setOpenRef] = useState<string | null>(null);

  if (openRef)
    return (
      <AssistantSkillEditor
        skillRef={openRef}
        onBack={() => setOpenRef(null)}
        onOpen={setOpenRef}
      />
    );

  const sections = skills.data ? sectionsOf(skills.data) : null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
      <h2 className="font-semibold">{t('skills.title')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('skills.hint')}</p>
      {skills.isPending ? (
        <div className="mt-4 flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : !sections ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {t('loadError')}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          {sections.pending.length ? (
            <section aria-label={t('skills.sections.pending')} className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t('skills.sections.pending')}</h3>
              <ul className="flex flex-col gap-2">
                {sections.pending.map((skill) => (
                  <PendingSkillCard key={skill.ref} skill={skill} />
                ))}
              </ul>
            </section>
          ) : null}
          <Section
            title={t('skills.sections.owner')}
            skills={sections.owner}
            empty={t('skills.ownerEmpty')}
            onOpen={setOpenRef}
          />
          <Section
            title={t('skills.sections.learned')}
            skills={sections.learned}
            onOpen={setOpenRef}
          />
          <Section
            title={t('skills.sections.platform')}
            skills={sections.platform}
            onOpen={setOpenRef}
          />
          <Section
            title={t('skills.sections.archived')}
            skills={sections.archived}
            onOpen={setOpenRef}
          />
        </div>
      )}
    </div>
  );
}
