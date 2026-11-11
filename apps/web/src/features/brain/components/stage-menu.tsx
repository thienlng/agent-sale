import { SIGNAL_STAGES, type SignalStage } from '@agent-sales/contracts';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { useSetStage } from '../api/brain';

/** Stage colours: warm for buying signals, quiet for the rest. */
const STAGE_TONE: Record<SignalStage, string> = {
  new: 'bg-muted text-muted-foreground',
  exploring: 'bg-muted text-foreground',
  price_asked: 'bg-warning-soft text-warning',
  ready: 'bg-primary-soft text-brand-text',
  won: 'bg-success-soft text-success',
  after_sale: 'bg-success-soft text-success',
  lost: 'bg-muted text-muted-foreground',
  spam: 'bg-muted text-muted-foreground',
};

/** The stage as a small pill; a lock when a member set it by hand. */
export function StageBadge({ stage, locked }: { stage: SignalStage; locked: boolean }) {
  const { t } = useTranslation('brain');
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium',
        STAGE_TONE[stage],
      )}
      title={locked ? t('stage.locked') : undefined}
    >
      {locked ? <Lock className="size-3" role="img" aria-label={t('stage.locked')} /> : null}
      {t(`stage.${stage}`)}
    </span>
  );
}

/**
 * "Đổi giai đoạn": a chosen stage is locked (the AI keeps it); "Để AI tự xác định" unlocks it.
 * Inside an item's action menu it is a submenu; `inline` renders the choices directly (a menu
 * opened by its own "Đổi giai đoạn" button).
 */
export function StageMenu({
  conversationId,
  stage,
  locked,
  inline = false,
}: {
  conversationId: string;
  stage: SignalStage;
  locked: boolean;
  inline?: boolean;
}) {
  const { t } = useTranslation('brain');
  const set = useSetStage();
  const change = (next: SignalStage | null) =>
    set.mutate(
      { conversationId, stage: next },
      {
        onSuccess: () => toast.success(t('stage.changed')),
        onError: () => toast.error(t('evaluate.failed')),
      },
    );
  const choices = (
    <>
      <DropdownMenuRadioGroup
        value={locked ? stage : ''}
        onValueChange={(v) => change(v as SignalStage)}
      >
        {SIGNAL_STAGES.map((s) => (
          <DropdownMenuRadioItem key={s} value={s}>
            {t(`stage.${s}`)}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      {locked ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => change(null)}>{t('stage.unlock')}</DropdownMenuItem>
        </>
      ) : null}
    </>
  );
  if (inline) return choices;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{t('stage.menu')}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>{choices}</DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
