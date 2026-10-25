import { Bot, ChevronDown, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { resumeCountdown } from '../lib/inbox-list';

type Option = 'bot' | 'temp' | 'permanent';

/** Who answers: bot, a person for a while (bot resumes), or a person for good. */
export function currentReplyOption(
  mode: 'bot' | 'human',
  takeover: 'temporary' | 'permanent' | null,
  autoResumeAt: string | null,
): Option {
  if (mode === 'bot') return 'bot';
  if (takeover) return takeover === 'temporary' ? 'temp' : 'permanent';
  return autoResumeAt ? 'temp' : 'permanent';
}

/** The request body for an option: the two takeovers differ in `takeover`. */
export function replyOptionBody(option: Option): ReplyModeChange {
  if (option === 'bot') return { mode: 'bot' };
  return { mode: 'human', takeover: option === 'temp' ? 'temporary' : 'permanent' };
}

export type ReplyModeChange =
  { mode: 'bot' } | { mode: 'human'; takeover: 'temporary' | 'permanent' };

export function ReplyModeMenu({
  mode,
  autoResumeAt,
  takeover,
  isMine,
  botAvailable,
  takeoverMinutes,
  disabled,
  onChange,
}: {
  mode: 'bot' | 'human';
  autoResumeAt: string | null;
  takeover: 'temporary' | 'permanent' | null;
  /** The current user is the assignee: only then the label says "you" took over. */
  isMine: boolean;
  /** False when the channel has no active bot. */
  botAvailable: boolean;
  takeoverMinutes: number | undefined;
  disabled: boolean;
  onChange: (change: ReplyModeChange) => void;
}) {
  const { t } = useTranslation();
  const tr = (key: string, options?: Record<string, unknown>) =>
    t(`channelInbox.v2.header.replyMode.${key}`, options ?? {});
  const [now, setNow] = useState(() => Date.now());
  const counting = mode === 'human' && Boolean(autoResumeAt);
  useEffect(() => {
    if (!counting) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [counting, autoResumeAt]);
  const current = currentReplyOption(mode, takeover, autoResumeAt);
  const countdown = current === 'temp' ? resumeCountdown(autoResumeAt, now) : null;
  const label =
    mode === 'bot'
      ? tr('bot')
      : countdown
        ? tr(isMine ? 'takeover' : 'takeoverOther', { time: countdown })
        : tr('human');
  const noBot = !botAvailable;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={mode === 'bot' ? 'secondary' : 'outline'}
          size="sm"
          disabled={disabled}
          aria-label={`${tr('label')}: ${label}`}
          className="max-w-full min-w-0"
        >
          {mode === 'bot' ? <Bot /> : <UserRound />}
          <span className="truncate">{label}</span>
          <ChevronDown className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(value) => {
            if (value === current) return;
            onChange(replyOptionBody(value as Option));
          }}
        >
          <ModeItem
            value="bot"
            title={tr('optionBot')}
            hint={tr('optionBotHint')}
            disabled={noBot}
            reason={noBot ? tr('noBot') : null}
          />
          <ModeItem
            value="temp"
            title={tr('optionTemp')}
            hint={
              takeoverMinutes
                ? tr('optionTempHint', { minutes: takeoverMinutes })
                : tr('optionTempHintNoBot')
            }
            disabled={noBot}
            reason={noBot ? tr('noBot') : null}
          />
          <ModeItem
            value="permanent"
            title={tr('optionPermanent')}
            hint={tr('optionPermanentHint')}
          />
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModeItem({
  value,
  title,
  hint,
  disabled = false,
  reason = null,
}: {
  value: Option;
  title: string;
  hint: string;
  disabled?: boolean;
  reason?: string | null;
}) {
  return (
    <DropdownMenuRadioItem value={value} disabled={disabled} className="items-start py-2">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs whitespace-normal text-muted-foreground">{hint}</span>
        {reason ? (
          <span className="text-xs whitespace-normal text-destructive">{reason}</span>
        ) : null}
      </span>
    </DropdownMenuRadioItem>
  );
}
