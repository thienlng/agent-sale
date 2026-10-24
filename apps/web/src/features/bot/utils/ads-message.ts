/**
 * Builds the Messenger Platform message JSON pasted into a Click-to-Messenger
 * ad's "message template" (Ads Manager → Message template → JSON).
 * Limits follow the Send API: quick reply and button titles ≤ 20 characters,
 * up to 13 quick replies, up to 3 buttons, generic element titles ≤ 80.
 */
export type AdsMessageType = 'text' | 'quick_replies' | 'image_buttons';

export interface AdsQuickReply {
  title: string;
  payload: string;
}

export interface AdsButton {
  kind: 'postback' | 'web_url';
  title: string;
  /** The postback payload or the https URL, depending on `kind`. */
  value: string;
}

export interface AdsMessageDraft {
  type: AdsMessageType;
  text: string;
  quickReplies: AdsQuickReply[];
  imageUrl: string;
  title: string;
  buttons: AdsButton[];
}

export const ADS_LIMITS = {
  text: 2000,
  quickReplies: 13,
  quickReplyTitle: 20,
  payload: 1000,
  title: 80,
  buttons: 3,
  buttonTitle: 20,
} as const;

export type AdsProblem =
  | 'text'
  | 'quickReplies'
  | 'quickReplyTitle'
  | 'imageUrl'
  | 'title'
  | 'buttons'
  | 'buttonTitle'
  | 'buttonValue';

export const emptyAdsDraft = (type: AdsMessageType): AdsMessageDraft => ({
  type,
  text: '',
  quickReplies: type === 'quick_replies' ? [{ title: '', payload: '' }] : [],
  imageUrl: '',
  title: '',
  buttons: type === 'image_buttons' ? [{ kind: 'postback', title: '', value: '' }] : [],
});

const isHttps = (value: string) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

/** What has to be fixed before the JSON is accepted by Meta. */
export function adsMessageProblems(draft: AdsMessageDraft): AdsProblem[] {
  const problems = new Set<AdsProblem>();
  if (draft.type !== 'image_buttons') {
    if (!draft.text.trim() || draft.text.length > ADS_LIMITS.text) problems.add('text');
  }
  if (draft.type === 'quick_replies') {
    if (!draft.quickReplies.length || draft.quickReplies.length > ADS_LIMITS.quickReplies)
      problems.add('quickReplies');
    for (const q of draft.quickReplies) {
      if (!q.title.trim() || q.title.length > ADS_LIMITS.quickReplyTitle)
        problems.add('quickReplyTitle');
    }
  }
  if (draft.type === 'image_buttons') {
    if (!isHttps(draft.imageUrl.trim())) problems.add('imageUrl');
    if (!draft.title.trim() || draft.title.length > ADS_LIMITS.title) problems.add('title');
    if (!draft.buttons.length || draft.buttons.length > ADS_LIMITS.buttons) problems.add('buttons');
    for (const b of draft.buttons) {
      if (!b.title.trim() || b.title.length > ADS_LIMITS.buttonTitle) problems.add('buttonTitle');
      if (b.kind === 'web_url' ? !isHttps(b.value.trim()) : b.value.length > ADS_LIMITS.payload)
        problems.add('buttonValue');
    }
  }
  return [...problems];
}

/** An empty payload falls back to the title, so every reply is still identifiable. */
const payloadOf = (title: string, payload: string) => payload.trim() || title.trim();

export function buildAdsMessage(draft: AdsMessageDraft): { message: Record<string, unknown> } {
  if (draft.type === 'image_buttons') {
    return {
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'generic',
            elements: [
              {
                title: draft.title.trim(),
                image_url: draft.imageUrl.trim(),
                buttons: draft.buttons.map((b) =>
                  b.kind === 'web_url'
                    ? { type: 'web_url', title: b.title.trim(), url: b.value.trim() }
                    : {
                        type: 'postback',
                        title: b.title.trim(),
                        payload: payloadOf(b.title, b.value),
                      },
                ),
              },
            ],
          },
        },
      },
    };
  }
  return {
    message: {
      text: draft.text.trim(),
      ...(draft.type === 'quick_replies'
        ? {
            quick_replies: draft.quickReplies.map((q) => ({
              content_type: 'text',
              title: q.title.trim(),
              payload: payloadOf(q.title, q.payload),
            })),
          }
        : {}),
    },
  };
}
