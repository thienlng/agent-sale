// Renders the plan cover pictures (`public/images/plans/*.png`, 800×600) that the Rapiz website
// chat bot shows on its plan cards (`rapiz-site-bot seed`). Copy from `site_content.py` PLANS;
// re-run after changing it:  node apps/site/tools/plan_images.mjs  (needs Playwright's Chrome).
/* global console, document -- a Node script; `document` is used inside page.evaluate. */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(site, 'package.json'))('@playwright/test');

const symbol = readFileSync(join(site, 'public/images/rapiz-symbol-faceted.svg'), 'utf8')
  .replace(/<title[^]*?<\/desc>/, '')
  .replace(/ role="img" aria-labelledby="title desc"/, '');
const font = (file) => readFileSync(join(site, 'public/fonts', file)).toString('base64');

const PLANS = [
  {
    file: 'free',
    name: 'Miễn phí',
    lead: 'Một người, một fanpage. Đủ để thử bot với khách thật.',
    facts: ['1 thành viên', '3 kênh', '1.000 lượt AI / 14 ngày'],
    bg: '#F7F3EE',
    ink: '#1F1F1F',
    muted: '#5D6470',
    mark: '#FF7A45',
  },
  {
    file: 'smart',
    name: 'Sales Smart',
    lead: 'Shop và cơ sở dịch vụ có đội sale nhỏ.',
    facts: ['5 thành viên', '5 kênh', '7.000 lượt AI / 30 ngày'],
    bg: 'linear-gradient(135deg,#FF8F5E 0%,#FF7A45 45%,#F0612B 100%)',
    ink: '#1F1F1F',
    muted: 'rgba(31,31,31,.72)',
    mark: '#1F1F1F',
  },
  {
    file: 'pro',
    name: 'Sales Pro',
    lead: 'Nhiều fanpage, nhiều chi nhánh, cần kết nối hệ thống.',
    facts: ['15 thành viên', '20 kênh', 'API và webhook'],
    bg: '#1F1F1F',
    ink: '#FFFFFF',
    muted: 'rgba(255,255,255,.68)',
    mark: '#FF7A45',
  },
  {
    file: 'neo',
    name: 'Sales Neo',
    lead: 'Chuỗi và doanh nghiệp nhiều thương hiệu.',
    facts: ['30 thành viên', '100 kênh', 'Không giới hạn khách'],
    bg: 'radial-gradient(120% 120% at 100% 100%,#B54708 0%,#3A1D0E 45%,#161616 100%)',
    ink: '#FFFFFF',
    muted: 'rgba(255,255,255,.68)',
    mark: '#FF7A45',
  },
];

const html = (p) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font('inter.woff2')}) format('woff2');font-weight:100 900}
@font-face{font-family:'Inter Tight';src:url(data:font/woff2;base64,${font('inter-tight.woff2')}) format('woff2');font-weight:100 900}
*{margin:0;box-sizing:border-box}
body{width:800px;height:600px;overflow:hidden;font-family:Inter,sans-serif;color:${p.ink};background:${p.bg}}
.c{position:relative;width:100%;height:100%;padding:56px 60px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:12px;font:600 24px/1 'Inter Tight';letter-spacing:.08em;text-transform:uppercase;color:${p.muted}}
.brand svg{width:40px;height:auto}
.brand svg #rapiz-symbol{fill:${p.mark}}
.big{position:absolute;right:-70px;top:-30px;width:440px;opacity:.16}
.big #rapiz-symbol{fill:${p.mark === '#1F1F1F' ? '#FFFFFF' : p.mark}}
h1{margin-top:auto;font:800 104px/1 'Inter Tight';letter-spacing:-.035em}
p{margin-top:18px;max-width:560px;font:500 28px/1.3 Inter;color:${p.muted}}
ul{display:flex;gap:12px;margin-top:40px;padding:0;list-style:none}
li{padding:10px 18px;border-radius:999px;font:600 22px/1.2 Inter;border:2px solid ${p.ink === '#FFFFFF' ? 'rgba(255,255,255,.22)' : 'rgba(31,31,31,.16)'};background:${p.ink === '#FFFFFF' ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.4)'}}
</style></head><body><div class="c">
<div class="big">${symbol}</div>
<div class="brand">${symbol}<span>Rapiz</span></div>
<h1>${p.name}</h1><p>${p.lead}</p>
<ul>${p.facts.map((f) => `<li>${f}</li>`).join('')}</ul>
</div></body></html>`;

const out = join(site, 'public/images/plans');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
for (const p of PLANS) {
  await page.setContent(html(p));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, `${p.file}.png`) });
}
await browser.close();
console.log(`wrote ${PLANS.length} pictures to ${out}`);
