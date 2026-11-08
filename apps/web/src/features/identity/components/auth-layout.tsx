import { BadgeCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { BrandMark, Logo } from '@/components/logo';
import { siteUrl } from '@/lib/env';

/**
 * Two halves: the form, and the one thing Rapiz does — a customer typing the
 * way real customers type, and the bot answering from the shop's own data.
 * The brand half is Charcoal with the orange R as its only graphic (brand identity v2:
 * flat surfaces, no glow, no decorative circles).
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        {/* Visitors here may still be deciding: the logo leads back to the marketing site. */}
        <a
          href={siteUrl()}
          aria-label={t('account.home')}
          className="self-start rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-3 focus-visible:ring-offset-background focus-visible:outline-none"
        >
          <Logo />
        </a>
        <div className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-sm py-10">{children}</div>
        </div>
      </div>
      <aside
        aria-hidden
        className="dark relative hidden overflow-hidden bg-background text-foreground lg:flex lg:items-center lg:justify-center"
      >
        {/* The R, cropped by the panel edge: brand geometry instead of decoration. */}
        <BrandMark className="absolute -right-24 -bottom-16 h-[30rem] opacity-[0.08]" />
        <span className="absolute inset-x-0 top-0 h-1 bg-primary" />
        <figure className="relative w-full max-w-md px-10">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 border-b pb-3 text-sm font-semibold">
              <BrandMark className="h-4" />
              {t('app.name')}
            </div>
            <div className="flex flex-col gap-3 pt-4 text-base">
              <p className="max-w-[85%] self-end rounded-xl rounded-br-sm bg-bubble-customer px-3.5 py-2 animate-[bubble-in_400ms_ease-out_200ms_both]">
                {t('auth.demo.customer')}
              </p>
              <div className="flex max-w-[88%] flex-col gap-1.5 animate-[bubble-in_400ms_ease-out_900ms_both]">
                <p className="rounded-xl rounded-bl-sm bg-bubble-bot px-3.5 py-2 text-primary-foreground">
                  {t('auth.demo.bot')}
                </p>
                <span className="inline-flex items-center gap-1 self-start rounded-md bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">
                  <BadgeCheck className="size-3.5" />
                  {t('auth.demo.source')}
                </span>
              </div>
            </div>
          </div>
          <figcaption className="mt-10 font-display text-2xl leading-snug font-semibold tracking-[-0.015em] text-balance text-white">
            {t('auth.demo.caption')}
          </figcaption>
        </figure>
      </aside>
    </div>
  );
}
