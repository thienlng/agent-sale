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
import { useAssistantForm } from '@/lib/assistant-context';
import { errorMessage } from '@/lib/errors';

import { useBotProfile } from '../api/bot-profile';
import { useSaveFaq } from '../api/faqs';
import { profileFieldForQuestion, profileFieldInputId } from '../utils/faq-profile-topics';

export interface FaqPrefill {
  question?: string;
  answer?: string;
}

const QUESTION_MAX = 500;
const ANSWER_MAX = 4000;

/** The owner assistant's `faq` form: the question and the answer of one new FAQ. */
export function faqFormFields(label: (key: 'question' | 'answer') => string, empty = true) {
  return [
    { name: 'question', label: label('question'), type: 'textarea' as const, empty },
    { name: 'answer', label: label('answer'), type: 'textarea' as const, empty },
  ];
}

/**
 * Add (faq = null) or edit a FAQ. A new FAQ starts from `prefill` (the owner assistant's draft).
 * While open for a new FAQ, the dialog registers the assistant's `faq` form itself.
 */
export function FaqDialog({
  botId,
  open,
  faq,
  prefill,
  onOpenChange,
}: {
  botId: string;
  open: boolean;
  faq: FaqDto | null;
  prefill?: FaqPrefill | null;
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
      setQuestion(faq?.question ?? prefill?.question?.slice(0, QUESTION_MAX) ?? '');
      setAnswer(faq?.answer ?? prefill?.answer?.slice(0, ANSWER_MAX) ?? '');
    }
  }, [open, faq, prefill]);

  // An edit is never filled (it is a proposal); only a new FAQ on screen is.
  useAssistantForm(
    'faq',
    () =>
      faqFormFields((key) => t(`faq.${key}`)).map((f) => ({
        ...f,
        empty: !(f.name === 'question' ? question : answer).trim(),
        value: f.name === 'question' ? question : answer,
      })),
    (values) => {
      if (typeof values['question'] === 'string')
        setQuestion(values['question'].slice(0, QUESTION_MAX));
      if (typeof values['answer'] === 'string') setAnswer(values['answer'].slice(0, ANSWER_MAX));
    },
    { enabled: open && !faq },
  );

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
              maxLength={QUESTION_MAX}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              autoFocus
            />
            {topic ? (
              <p role="note" className="text-sm text-muted-foreground">
                {tt('profile.faqHint', { field: tt(`profile.fields.${topic}`) })}{' '}
                <button
                  type="button"
                  className="font-medium text-brand-text underline-offset-2 hover:underline"
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
              maxLength={ANSWER_MAX}
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
