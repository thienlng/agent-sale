import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { shortUrl, WebsiteVisitorBlock } from './website-visitor-block';

const mocks = vi.hoisted(() => ({ visitor: { data: undefined, isError: false } as unknown }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../api/inbox', () => ({ useWebsiteVisitor: () => mocks.visitor }));

const visitor = {
  firstUrl: 'https://shop.test/?gclid=abc',
  referrer: 'https://www.google.com/',
  lastUrl: 'https://shop.test/ao-thun',
  lastTitle: 'Áo thun',
  phone: '+84912345679',
  contactId: null,
  createdAt: '2026-10-27T10:00:00.000Z',
};

describe('website visitor block', () => {
  it('shows the first page, the page they are on, the referrer and the phone', () => {
    mocks.visitor = { data: visitor, isError: false };
    render(<WebsiteVisitorBlock conversationId="c1" />);
    expect(screen.getByText('shop.test')).toBeInTheDocument();
    expect(screen.getByText('shop.test/ao-thun')).toBeInTheDocument();
    expect(screen.getByText('Áo thun')).toBeInTheDocument();
    expect(screen.getByText('www.google.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+84912345679' })).toHaveAttribute(
      'href',
      'tel:+84912345679',
    );
  });

  it('says so when the visitor came directly and has not left a number', () => {
    mocks.visitor = { data: { ...visitor, referrer: null, phone: null }, isError: false };
    render(<WebsiteVisitorBlock conversationId="c1" />);
    expect(screen.getByText('channelInbox.v2.visitor.direct')).toBeInTheDocument();
    expect(screen.getByText('channelInbox.v2.visitor.noPhone')).toBeInTheDocument();
  });

  it('does not link a non-http address', () => {
    mocks.visitor = { data: { ...visitor, firstUrl: 'javascript:alert(1)' }, isError: false };
    render(<WebsiteVisitorBlock conversationId="c1" />);
    expect(screen.queryByRole('link', { name: /alert/ })).not.toBeInTheDocument();
  });

  it('reports a load failure', () => {
    mocks.visitor = { data: undefined, isError: true };
    render(<WebsiteVisitorBlock conversationId="c1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('channelInbox.v2.visitor.loadError');
  });
});

describe('shortUrl', () => {
  it('drops the scheme, the query and a bare slash', () => {
    expect(shortUrl('https://shop.test/a?x=1')).toBe('shop.test/a');
    expect(shortUrl('https://shop.test/')).toBe('shop.test');
    expect(shortUrl('not a url')).toBe('not a url');
  });
});
