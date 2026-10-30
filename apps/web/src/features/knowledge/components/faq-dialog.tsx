import type { FaqDto } from '@agent-sales/contracts';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/errors';

import { useBotProfile } from '../api/bot-profile';
import { useSaveFaq } from '../api/faqs';
import { profileFieldForQuestion, profileFieldInputId } from '../utils/faq-profile-topics';

/** Add (faq = null) or edit a FAQ. */
export function FaqDialog({
  botId,
  open,
  faq,
  onOpenChange,
}: {
  botId: string;
  open: boolean;
  faq: FaqDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { t: tt } = useTranslation('training');
  const bot = useBotProfile(botId);
  const jumpTo = useRef<string | null>(null);
  const save = useSaveFaq(botId);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');

  useEffect(() => {
    if (open) {
      setQuestion(faq?.question ?? '');
      setAnswer(faq?.answer ?? '');
    }
  }, [open, faq]);

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate(
      { ...(faq ? { id: faq.id } : {}), question: question.trim(), answer: answer.trim() },
      {
        onSuccess: () => {
          toast.success(t('faq.saved'));
          onOpenChange(false);
        },
        onError: (err) => toast.error(errorMessage(t, err)),
      },
    );
  }

  const topic = bot.data ? profileFieldForQuestion(question, bot.data.industry) : null;
  /** Closes the dialog, then focuses the profile field once the dialog has given focus back. */
  function goToField(id: string) {
    jumpTo.current = id;
    onOpenChange(false);
  }

  const valid = question.trim().length >= 3 && answer.trim().length >= 1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(e) => {
          const el = jumpTo.current ? document.getElementById(jumpTo.current) : null;
          jumpTo.current = null;
          if (!el) return;
          e.preventDefault();
          el.scrollIntoView?.({ block: 'center' });
          el.focus({ preventScroll: true });
        }}
      >
        <form onSubmit={submit} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{faq ? t('faq.editTitle') : t('faq.addTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="faq-question">{t('faq.question')}</Label>
            <Textarea
              id="faq-question"
              rows={2}
              maxLength={500}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              autoFocus
            />
            {topic ? (
              <p role="note" className="text-sm text-muted-foreground">
                {tt('profile.faqHint', { field: tt(`profile.fields.${topic}`) })}{' '}
                <button
                  type="button"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() => goToField(profileFieldInputId(topic))}
                >
                  {tt('profile.faqHintGo')}
                </button>
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="faq-answer">{t('faq.answer')}</Label>
            <Textarea
              id="faq-answer"
              rows={5}
              maxLength={4000}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              aria-describedby="faq-answer-hint"
            />
            <p id="faq-answer-hint" className="text-sm text-muted-foreground">
              {t('faq.answerHint', { example: '{{store.address}}' })}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
