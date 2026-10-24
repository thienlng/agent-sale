import { Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import {
  ADS_LIMITS,
  type AdsButton,
  type AdsMessageDraft,
  type AdsProblem,
  type AdsQuickReply,
} from '../utils/ads-message';

type Update = (change: Partial<AdsMessageDraft>) => void;

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** Fields of the chosen message type; limits are enforced by `maxLength` and the problem list. */
export function AdsMessageForm({
  draft,
  problems,
  update,
}: {
  draft: AdsMessageDraft;
  problems: AdsProblem[];
  update: Update;
}) {
  const { t } = useTranslation('training');
  const replies = draft.quickReplies;
  const buttons = draft.buttons;
  const setReply = (i: number, change: Partial<AdsQuickReply>) =>
    update({ quickReplies: replies.map((q, j) => (j === i ? { ...q, ...change } : q)) });
  const setButton = (i: number, change: Partial<AdsButton>) =>
    update({ buttons: buttons.map((b, j) => (j === i ? { ...b, ...change } : b)) });

  return (
    <div className="flex flex-col gap-5">
      {draft.type !== 'image_buttons' ? (
        <Field id="ads-text" label={t('space.ads.text')}>
          <Textarea
            id="ads-text"
            rows={4}
            maxLength={ADS_LIMITS.text}
            aria-invalid={problems.includes('text')}
            value={draft.text}
            onChange={(e) => update({ text: e.target.value })}
          />
        </Field>
      ) : (
        <>
          <Field id="ads-image" label={t('space.ads.imageUrl')}>
            <Input
              id="ads-image"
              type="url"
              inputMode="url"
              placeholder="https://"
              aria-invalid={Boolean(draft.imageUrl) && problems.includes('imageUrl')}
              value={draft.imageUrl}
              onChange={(e) => update({ imageUrl: e.target.value })}
            />
          </Field>
          <Field id="ads-title" label={t('space.ads.cardTitle')}>
            <Input
              id="ads-title"
              maxLength={ADS_LIMITS.title}
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
            />
          </Field>
        </>
      )}

      {draft.type === 'quick_replies' ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">
            {t('space.ads.quickReplies', { count: replies.length, max: ADS_LIMITS.quickReplies })}
          </legend>
          {replies.map((q, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label={t('space.ads.replyTitle', { n: i + 1 })}
                placeholder={t('space.ads.titlePlaceholder')}
                maxLength={ADS_LIMITS.quickReplyTitle}
                value={q.title}
                onChange={(e) => setReply(i, { title: e.target.value })}
              />
              <Input
                aria-label={t('space.ads.replyPayload', { n: i + 1 })}
                placeholder={t('space.ads.payloadPlaceholder')}
                maxLength={ADS_LIMITS.payload}
                value={q.payload}
                onChange={(e) => setReply(i, { payload: e.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('space.ads.remove')}
                disabled={replies.length <= 1}
                onClick={() => update({ quickReplies: replies.filter((_, j) => j !== i) })}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={replies.length >= ADS_LIMITS.quickReplies}
            onClick={() => update({ quickReplies: [...replies, { title: '', payload: '' }] })}
          >
            <Plus />
            {t('space.ads.addReply')}
          </Button>
        </fieldset>
      ) : null}

      {draft.type === 'image_buttons' ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">
            {t('space.ads.buttons', { count: buttons.length, max: ADS_LIMITS.buttons })}
          </legend>
          {buttons.map((b, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Select
                  value={b.kind}
                  onValueChange={(kind) => setButton(i, { kind: kind as AdsButton['kind'] })}
                >
                  <SelectTrigger
                    className="w-40 shrink-0"
                    aria-label={t('space.ads.buttonKind', { n: i + 1 })}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="postback">{t('space.ads.kinds.postback')}</SelectItem>
                    <SelectItem value="web_url">{t('space.ads.kinds.web_url')}</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  aria-label={t('space.ads.buttonTitle', { n: i + 1 })}
                  placeholder={t('space.ads.titlePlaceholder')}
                  maxLength={ADS_LIMITS.buttonTitle}
                  value={b.title}
                  onChange={(e) => setButton(i, { title: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('space.ads.remove')}
                  disabled={buttons.length <= 1}
                  onClick={() => update({ buttons: buttons.filter((_, j) => j !== i) })}
                >
                  <Trash2 />
                </Button>
              </div>
              <Input
                aria-label={t(
                  b.kind === 'web_url' ? 'space.ads.buttonUrl' : 'space.ads.buttonPayload',
                  {
                    n: i + 1,
                  },
                )}
                placeholder={b.kind === 'web_url' ? 'https://' : t('space.ads.payloadPlaceholder')}
                type={b.kind === 'web_url' ? 'url' : 'text'}
                maxLength={ADS_LIMITS.payload}
                value={b.value}
                onChange={(e) => setButton(i, { value: e.target.value })}
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={buttons.length >= ADS_LIMITS.buttons}
            onClick={() =>
              update({ buttons: [...buttons, { kind: 'postback', title: '', value: '' }] })
            }
          >
            <Plus />
            {t('space.ads.addButton')}
          </Button>
        </fieldset>
      ) : null}

      {problems.length ? (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {problems.map((p) => (
            <li key={p}>{t(`space.ads.problems.${p}`, { ...ADS_LIMITS })}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
