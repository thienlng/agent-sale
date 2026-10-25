import actionEn from './messages/en/action.json' with { type: 'json' };
import actionVi from './messages/vi/action.json' with { type: 'json' };
import channelInboxEn from './messages/en/channel-inbox.json' with { type: 'json' };
import channelInboxVi from './messages/vi/channel-inbox.json' with { type: 'json' };
import en from './messages/en/common.json' with { type: 'json' };
import vi from './messages/vi/common.json' with { type: 'json' };

import trainingEn from './messages/en/training.json' with { type: 'json' };
import trainingVi from './messages/vi/training.json' with { type: 'json' };

export const locales = ['vi', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'vi';

export const resources = {
  vi: { common: { ...vi, channelInbox: channelInboxVi }, training: trainingVi, action: actionVi },
  en: { common: { ...en, channelInbox: channelInboxEn }, training: trainingEn, action: actionEn },
} as const;

export type CommonMessages = typeof vi;
