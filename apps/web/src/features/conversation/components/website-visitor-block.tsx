import { useTranslation } from 'react-i18next';
import { formatPhone } from '@/lib/format';
import { useWebsiteVisitor } from '../api/inbox';
import { PanelBlock } from './panel-block';

/** A page address for people: no scheme, trimmed; falls back to the raw text when it is not a URL. */
export function shortUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const text = `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
    return text.length > 60 ? `${text.slice(0, 59)}…` : text;
  } catch {
    return raw.slice(0, 60);
  }
}

function PageLink({ url, title }: { url: string; title?: string | null }) {
  const safe = /^https?:\/\//i.test(url);
  return (
    <>
      {title ? <span className="block truncate">{title}</span> : null}
      {safe ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-xs text-brand-text hover:underline"
        >
          {shortUrl(url)}
        </a>
      ) : (
        <span className="block truncate text-xs text-muted-foreground">{shortUrl(url)}</span>
      )}
    </>
  );
}

/** Side panel of a website conversation: how the visitor arrived, where they are and their number or email. */
export function WebsiteVisitorBlock({
  conversationId,
  customerPhone,
}: {
  conversationId: string;
  /** The number the conversation already knows ("Giới thiệu"): shown when the widget has none. */
  customerPhone?: string | null | undefined;
}) {
  const { t } = useTranslation();
  const v = (key: string) => t(`channelInbox.v2.visitor.${key}`);
  const visitor = useWebsiteVisitor(conversationId, true);
  const data = visitor.data;
  // One number for one customer (MS2-12): the visitor's own, else the conversation's.
  const phone = data?.phone || customerPhone || null;
  return (
    <PanelBlock title={v('title')}>
      {visitor.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {v('loadError')}
        </p>
      ) : !data ? null : (
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{v('firstPage')}</dt>
            <dd>{data.firstUrl ? <PageLink url={data.firstUrl} /> : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{v('currentPage')}</dt>
            <dd>{data.lastUrl ? <PageLink url={data.lastUrl} title={data.lastTitle} /> : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{v('referrer')}</dt>
            <dd>
              {data.referrer ? (
                <PageLink url={data.referrer} />
              ) : (
                <span className="text-muted-foreground">{v('direct')}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{v('phone')}</dt>
            <dd>
              {phone ? (
                <a href={`tel:${phone}`} className="hover:underline">
                  {formatPhone(phone)}
                </a>
              ) : (
                <span className="text-muted-foreground">{v('noPhone')}</span>
              )}
            </dd>
          </div>
          {data.email ? (
            <div>
              <dt className="text-xs text-muted-foreground">{v('email')}</dt>
              <dd className="truncate">
                <a href={`mailto:${data.email}`} className="hover:underline">
                  {data.email}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
      )}
    </PanelBlock>
  );
}
