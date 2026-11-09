import { Check, MessageCircle, ScanBarcode, SquareMousePointer } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BrandMark, Logo } from '@/components/logo';
import { siteUrl } from '@/lib/env';

import './login-layout.css';

const messages = [
  {
    channel: 'Messenger',
    preview: 'stockQuestion',
    title: 'questionLead',
    accent: 'questionAccent',
    reply: 'reply',
    result: 'checked',
    detail: 'stock',
  },
  {
    channel: 'Website',
    preview: 'webQuestion',
    title: 'colorLead',
    accent: 'colorAccent',
    reply: 'colorReply',
    result: 'checked',
    detail: 'colorResult',
  },
  {
    channel: 'Messenger',
    preview: 'deliveryQuestion',
    title: 'deliveryLead',
    accent: 'deliveryAccent',
    reply: 'deliveryReply',
    result: 'handoff',
    detail: 'handoffResult',
  },
] as const;

function SalesConversation() {
  const { t } = useTranslation();
  const [message, setMessage] = useState<(typeof messages)[number]>(messages[0]);
  const ChannelIcon = message.channel === 'Website' ? SquareMousePointer : MessageCircle;
  return (
    <aside className="login-poster" aria-label={t('auth.salesExample.sample')}>
      <div className="login-poster-inner">
        <div className="login-poster-caption">
          <span />
          {t('auth.salesExample.sample')}
        </div>
        <div className="login-incoming" role="group" aria-label={t('auth.salesExample.pick')}>
          {messages.map((item) => {
            const Icon = item.channel === 'Website' ? SquareMousePointer : MessageCircle;
            return (
              <button
                key={item.preview}
                type="button"
                className="login-preview"
                aria-pressed={message === item}
                aria-controls="login-conversation"
                onClick={() => setMessage(item)}
              >
                <Icon aria-hidden size={15} />
                <span>
                  <small>{item.channel}</small>
                  <strong>{t(`auth.salesExample.${item.preview}`)}</strong>
                </span>
              </button>
            );
          })}
        </div>
        <div id="login-conversation" aria-live="polite" aria-atomic="true">
          <div className="login-lead-message" key={message.title}>
            <span className="login-lead-source">
              <ChannelIcon aria-hidden size={15} />
              {message.channel}
            </span>
            <blockquote>
              {t(`auth.salesExample.${message.title}`)} <br />
              <em>{t(`auth.salesExample.${message.accent}`)}</em>
            </blockquote>
          </div>
          <div className="login-answer" key={message.reply}>
            <div className="login-answer-title">
              <BrandMark className="h-5" />
              Rapiz Agent
            </div>
            <p className="login-response">{t(`auth.salesExample.${message.reply}`)}</p>
            <div className="login-stock">
              {message.result === 'handoff' ? (
                <MessageCircle aria-hidden size={21} />
              ) : (
                <ScanBarcode aria-hidden size={21} />
              )}
              <div>
                <span>{t(`auth.salesExample.${message.result}`)}</span>
                <strong>{t(`auth.salesExample.${message.detail}`)}</strong>
              </div>
              <Check aria-hidden size={17} />
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function LoginLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <main className="login-entry">
      <div className="login-paper">
        <a className="login-signature" href={siteUrl()} aria-label={t('account.home')}>
          <Logo />
        </a>
        <div className="login-fields">{children}</div>
      </div>
      <SalesConversation />
    </main>
  );
}
