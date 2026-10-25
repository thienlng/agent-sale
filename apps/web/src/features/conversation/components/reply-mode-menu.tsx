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
export function currentReplyOption(mode: 'bot' | 'human', autoResumeAt: string | null): Option {
  if (mode === 'bot') return 'bot';
  return autoResumeAt ? 'temp' : 'permanent';
}

export function ReplyModeMenu({
  mode,
  autoResumeAt,
  botAvailable,
  takeoverMinutes,
  disabled,
  onChange,
}: {
  mode: 'bot' | 'human';
  autoResumeAt: string | null;
  /** False when the channel has no active bot. */
  botAvailable: boolean;
  takeoverMinutes: number | undefined;
  disabled: boolean;
  onChange: (mode: 'bot' | 'human') => void;
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
  const countdown = mode === 'human' ? resumeCountdown(autoResumeAt, now) : null;
  const current = currentReplyOption(mode, autoResumeAt);
  const label =
    mode === 'bot' ? tr('bot') : countdown ? tr('takeover', { time: countdown }) : tr('human');
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
            onChange(value === 'bot' ? 'bot' : 'human');
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
