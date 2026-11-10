"""Build the Rapiz sub-pages and keep the shared chrome in sync.

Writes every page listed in site_content.PAGES as <slug>/index.html, and replaces the
marked header, footer and pricing blocks inside index.html. Run from anywhere:

    python3 tools/build_site.py
"""
from __future__ import annotations

import json
import os
import re
from html import escape
from pathlib import Path

import site_content as C

SITE = Path(__file__).resolve().parent.parent
ROOT = SITE / 'public'


# ---------- small helpers ----------

def rel(depth: int) -> str:
    return '../' * depth


def tag(status: str | None) -> str:
    if not status:
        return ''
    cls = 'tag soon' if status == 'Sắp ra mắt' else 'tag plan' if status.startswith('Gói') else 'tag'
    return f'<span class="{cls}">{status}</span>'


def href(root: str, slug: str) -> str:
    """Link to a page by slug ('' is home, '#x' an anchor on home, 'http…' external)."""
    if slug.startswith(('http', '/')):
        return slug
    if slug.startswith('#'):
        return f'{root}index.html{slug}' if root else slug
    if slug == '':
        return f'{root}index.html' if root else 'index.html'
    return f'{root}{slug}/'


def kicker(text: str) -> str:
    return f'<p class="kicker"><i class="slashes" aria-hidden="true"></i> {text}</p>'


def ticks(items: list[str]) -> str:
    return '<ul class="ticks">' + ''.join(f'<li><span>{i}</span></li>' for i in items) + '</ul>'


# ---------- shared chrome ----------

def header(root: str, current: str = '') -> str:
    def panel(pid: str, label: str, links: list[dict], group_key: str) -> str:
        items = ''.join(
            f'<a href="{href(root, l["slug"])}"{" aria-current=\"page\"" if l["slug"] == current else ""}>'
            f'<strong>{l["name"]}{tag(l.get("status"))}</strong><small>{l["blurb"]}</small></a>'
            for l in links
        )
        is_current = any(l['slug'] == current for l in links)
        return (
            f'<div class="nav-group{" current" if is_current else ""}">'
            f'<button type="button" class="nav-trigger" aria-expanded="false" aria-controls="{pid}">{label}</button>'
            f'<div class="nav-panel" id="{pid}">{items}</div></div>'
        )

    plain = ''.join(
        f'<a href="{href(root, s)}"{" aria-current=\"page\"" if s == current else ""}>{n}</a>'
        for n, s in C.NAV_PLAIN
    )
    home = href(root, '')
    return f'''<!--#site-head-->
<a class="skip" href="#main">Đến nội dung chính</a>
<header class="site-head">
  <div class="container head-inner">
    <a class="brand" href="{home}" aria-label="Rapiz, trang chủ"><img src="{root}images/rapiz-logo-faceted.svg" width="143" height="50" alt="Rapiz"></a>
    <nav id="nav" aria-label="Điều hướng chính">
      {panel("nav-solutions", "Giải pháp", C.INDUSTRY_LINKS, "industries")}{panel("nav-features", "Tính năng", C.FEATURE_LINKS + [C.PLATFORM_LINK], "features")}{plain}<a class="nav-login" href="{C.LOGIN_URL}">Đăng nhập</a>
    </nav>
    <div class="head-actions">
      <a class="head-login" href="{C.LOGIN_URL}">Đăng nhập</a>
      <a class="head-cta" href="{href(root, "dat-lich-demo")}">Đặt lịch demo <span aria-hidden="true">↗</span></a>
    </div>
    <button class="nav-toggle" aria-controls="nav" aria-expanded="false" aria-label="Mở menu"><span></span><span></span></button>
  </div>
</header>
<!--/site-head-->'''


def tie(heading: str) -> str:
    """Joins the last two words of each heading line with a no-break space, so a line never ends on one
    orphan word and Vietnamese compounds ("kiểm tra", "cài đặt") are not split across lines."""
    def line(part: str) -> str:
        head, sep, tail = part.rpartition(' ')
        return f'{head}&nbsp;{tail}' if sep and head.strip() and '<' not in tail.replace('</em>', '') else part
    return '<br>'.join(line(part) for part in re.split(r'<br\s*/?>', heading))


def footer(root: str, page: dict | None = None) -> str:
    page = page or {}
    closing = next((block for block in page.get('blocks', []) if block['kind'] == 'close'), {})
    title = closing.get('h2', 'Sẵn sàng thử <em>Rapiz?</em>')
    demo = href(root, 'dat-lich-demo') + closing.get('demo_query', '')
    if page.get('slug') == 'dat-lich-demo':
        demo = '#demo-form'

    def col(label: str, links: list[tuple]) -> str:
        items = ''.join(f'<li><a href="{href(root, slug)}">{name}</a>{tag(status)}</li>'
                        for name, slug, status in links)
        return f'<nav class="foot-col" aria-label="{label}"><p class="foot-title">{label}</p><ul>{items}</ul></nav>'

    industries = [(link['name'], link['slug'], link.get('status')) for link in C.INDUSTRY_LINKS]
    features = [(link['name'], link['slug'], link.get('status')) for link in C.FEATURE_LINKS]
    words = ('Tư vấn khách hàng', 'Tra dữ liệu của shop', 'Chốt đơn trong chat', 'Phối hợp cùng đội sale')
    ribbon = ''.join(f'<span>{word}<i></i></span>' for word in words)
    return f'''<!--#site-foot-->
<footer class="site-foot" id="footer" aria-labelledby="close-title">
  <div class="rf-ribbon" aria-hidden="true"><div class="rf-track">
    <div>{ribbon}</div><div>{ribbon}</div>
  </div></div>
  <div class="rf-center">
    <h2 class="rf-title" id="close-title">{tie(title)}</h2>
    <div class="rf-actions">
      <a class="rf-primary" href="{demo}">Đặt lịch demo <span aria-hidden="true">↗</span></a>
      <a class="rf-secondary" href="{href(root, '#solutions')}">Thử hội thoại <span aria-hidden="true">→</span></a>
    </div>
    <nav class="rf-quick" aria-label="Tìm hiểu về Rapiz">
      <a href="{href(root, 've-rapiz')}">Về Rapiz</a><a href="{href(root, 'bang-gia')}">Bảng giá</a><a href="{href(root, 'bao-mat')}">Bảo mật</a>
    </nav>
  </div>
  <div class="rf-tail">
    <div class="rf-imprint" aria-hidden="true"></div>
    <div class="rf-grid">
      <div class="rf-company">
        <a class="rf-brand" href="{href(root, '')}" aria-label="Rapiz, trang chủ"><img src="{root}images/rapiz-symbol-faceted.svg" alt="" width="23" height="20"><span>Rapiz</span></a>
        <p>Nhân viên sale AI cho doanh nghiệp Việt.</p>
        <address>
          <strong>{C.COMPANY['name']}</strong>
          <span>{C.COMPANY['name_en']}</span>
          <a href="mailto:{C.COMPANY['email']}">{C.COMPANY['email']}</a>
        </address>
      </div>
      <div class="rf-columns">
        {col('Giải pháp', industries)}
        {col('Tính năng', features)}
        {col('Nền tảng', C.FOOT_PLATFORM)}
        {col('Tài khoản', C.FOOT_ACCOUNT)}
      </div>
    </div>
    <div class="rf-base">
      <span>© 2026 {C.COMPANY['short']}</span>
      <a class="rf-up" href="#top" aria-label="Về đầu trang"><span aria-hidden="true">↑</span></a>
    </div>
  </div>
</footer>
<!--/site-foot-->'''


def head(root: str, title: str, description: str, canonical: str, assets: list[str] | None = None) -> str:
    styles = 'detail-design.css' if canonical.startswith(('nganh/', 'tinh-nang/')) else 'utility-design.css'
    if canonical == 've-rapiz/':
        styles = 'business-os.css'
    # Feature pages list their own styles and scripts; only the route that uses a demo loads it.
    handoff_assets = ''.join(
        f'<link rel="stylesheet" href="{root}static/{name}">' if name.endswith('.css') else f'<script defer src="{root}static/{name}"></script>'
        for name in assets or []
    )
    return f'''<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f9f8f5">
  <meta name="description" content="{escape(description)}">
  <title>{escape(title)}</title>
  <link rel="canonical" href="{C.SITE_URL}{canonical}">
  <meta property="og:title" content="{escape(title)}">
  <meta property="og:description" content="{escape(description)}">
  <meta property="og:locale" content="vi_VN">
  <link rel="icon" type="image/svg+xml" href="{root}images/favicon-light.svg">
  <link rel="preload" as="font" href="{root}fonts/inter-tight.woff2" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="{root}static/landing.css">
  <link rel="stylesheet" href="{root}static/motion.css">
  <link rel="stylesheet" href="{root}static/site.css">
  <link rel="stylesheet" href="{root}static/brand.css">
  <link rel="stylesheet" href="{root}static/{styles}">
  {handoff_assets}<script defer src="{root}static/site.js"></script>
  <script defer src="{root}static/motion.js"></script>
  <script defer src="{root}static/site-widget.js"></script>
</head>
<body id="top">'''


# ---------- section renderers ----------

def detail_crumb(root: str, group: str) -> str:
    return f'<p class="detail-crumb"><a href="{href(root, "")}">Rapiz</a><span aria-hidden="true">/</span>{group}</p>'


def detail_actions(root: str, p: dict) -> str:
    if p.get('hero_actions') is False:
        return ''
    first_demo = next((n for n, block in enumerate(p["blocks"], 1) if block["kind"] == "player"), None)
    target = f"#s{first_demo or 1}"
    label = "Xem hội thoại mẫu" if first_demo else "Khám phá tính năng"
    return (
        f'<div class="hero-actions"><a class="btn primary" href="{target}">{label} '
        f'<span aria-hidden="true">↓</span></a><a class="text-link" href="{href(root, "dat-lich-demo")}'
        f'{p.get("demo_query", "")}">Đặt lịch demo <span aria-hidden="true">→</span></a></div>'
    )


def detail_points(points: list[str]) -> str:
    return '<ul class="detail-points">' + ''.join(f'<li>{point}</li>' for point in points) + '</ul>'


def detail_title(p: dict) -> str:
    text = re.sub(r'<br\s*/?>', ' ', p['h1'], flags=re.I)
    return text.replace('<em>', '').replace('</em>', '')


def industry_hero(root: str, p: dict) -> str:
    v = p['visual']
    demo_number, demo = next((n, block) for n, block in enumerate(p['blocks'], 1) if block['kind'] == 'player')
    message = next(item[1] for item in demo['thread'] if item[0] == 'c')
    label, result = v['card']
    edition = p['slug'].split('/')[-1]
    return f'''<section class="industry-spread" data-edition="{edition}" aria-labelledby="page-title">
  <div class="industry-cover">
    <img class="industry-photo" src="{root}images/{v["img"]}" width="{v["w"]}" height="{v["h"]}" alt="{escape(v["alt"])}" fetchpriority="high">
    <div class="container industry-cover-inner">
      <header class="industry-nameplate">
        {detail_crumb(root, p["group"])}
        <h1 id="page-title">{detail_title(p)}</h1>
      </header>
    </div>
  </div>
  <div class="container industry-notes">
    <div class="industry-brief">
      <p class="detail-deck">{p["deck"]}</p>
      {detail_actions(root, p)}
    </div>
    <a class="industry-vignette" href="#s{demo_number}">
      <small>{label}</small><q>{escape(message)}</q>
      <span>{result}</span><i aria-hidden="true">↘</i>
    </a>
  </div>
  <div class="container industry-facts">{detail_points(p.get("points", []))}</div>
</section>'''


def feature_hero(root: str, p: dict) -> str:
    v = p['visual']
    medium = v.get('mock', {}).get('type', 'screen')
    if v.get('mock'):
        proof = render_mock(root, v['mock'])
    else:
        image = f'{root}images/{v["img"]}'
        proof = (
            f'<a class="dossier-screen" href="{image}" target="_blank" rel="noopener" aria-label="Mở ảnh giao diện gốc trong thẻ mới">'
            f'<img src="{image}" width="{v["w"]}" height="{v["h"]}" alt="{escape(v["alt"])}" fetchpriority="high">'
            '<span>Mở ảnh gốc ↗</span></a>'
        )
    return f'''<section class="feature-dossier" data-exhibit="{medium}" aria-labelledby="page-title">
  <header class="container exhibit-mast">
    {detail_crumb(root, p["group"])}
    <h1 id="page-title">{detail_title(p)}</h1>
  </header>
  <div class="exhibit-stage">
    <div class="container exhibit-inner">
      <div class="dossier-proof">{proof}</div>
    </div>
  </div>
  <div class="container exhibit-caption">
    <div class="exhibit-description"><p class="detail-deck">{p["deck"]}</p>{detail_points(p.get("points", []))}</div>
    {detail_actions(root, p)}
  </div>
</section>'''


def feature_cover(root: str, p: dict) -> str:
    c = p['cover']
    # The second link goes to the real screen, or to the "more" block on a page that has no screenshot yet.
    proof, label = next(((n, 'Xem giao diện') for n, block in enumerate(p['blocks'], 1) if block['kind'] == 'inspect'), (None, ''))
    if proof is None:
        proof, label = next((n, c.get('more_link', 'Xem thêm')) for n, block in enumerate(p['blocks'], 1) if block['kind'] == 'more')
    return f'''<section class="fe-cover" data-edition="{p["slug"].split("/")[-1]}" aria-labelledby="page-title">
  <div class="container fe-layout">
    <header class="fe-opening">
      <p class="fe-crumb"><a href="{href(root, "")}">Rapiz</a><span aria-hidden="true">/</span> {C.LINK_INDEX[p["slug"]]["name"]}</p>
      <h1 id="page-title">{c["h1"]}</h1>
      <p class="fe-deck">{c["deck"]}</p>
      <div class="fe-actions"><a href="#{c["demo"]}" class="btn primary">{c["cta"]} <span aria-hidden="true">↘</span></a><a class="text-link" href="#s{proof}">{label} <span aria-hidden="true">↓</span></a></div>
    </header>
    {template(c["scene"], root=root)}
  </div>
</section>'''


def render_inspect(root: str, block: dict, n: int) -> str:
    # The real screen, always shown whole. Notes beside it say what to look at; the image opens larger in a popup.
    image = f'{root}images/{block["img"]}'
    notes = ''.join(f'<div><dt>{label}</dt><dd>{text}</dd></div>' for label, text in block['notes'])
    lead = f'<p>{block["lead"]}</p>' if block.get('lead') else ''
    # Light window bar so a cropped screenshot does not float bare on the page.
    bar = (f'<div class="fe-window" aria-hidden="true"><span><i></i><i></i><i></i></span><small>{block["window"]}</small></div>'
           if block.get('window') else '')
    return f'''<section class="fe-proof" aria-labelledby="s{n}">
 <div class="container fe-atlas">
  <div class="fe-proof-intro">{kicker(block["kicker"])}
   <h2 id="s{n}">{tie(block["h2"])}</h2>{lead}
   <dl class="fe-notes">{notes}</dl>
  </div>
  <figure class="fe-inspect">
   {bar}<a class="fe-frame" href="{image}" tabindex="-1" data-lightbox="{escape(block["caption"])}"><img src="{image}" width="{block["w"]}" height="{block["h"]}" alt="{escape(block["alt"])}" decoding="async" loading="lazy"></a>
   <figcaption><span>{block["caption"]}</span><a href="{image}" data-lightbox="{escape(block["caption"])}">Xem ảnh lớn <span aria-hidden="true">↗</span></a></figcaption>
  </figure>
 </div>
</section>'''


def render_more(root: str, block: dict, n: int) -> str:
    items = ''.join(f'<li><b>{title}</b><p>{text}</p><small>{where}</small></li>' for title, text, where in block['items'])
    return f'''<section class="fe-more" aria-labelledby="s{n}">
  <div class="container fe-more-grid">
    <div>{kicker(block.get("kicker", "CÒN TRONG TÍNH NĂNG NÀY"))}<h2 id="s{n}">{tie(block["h2"])}</h2></div>
    <ul>{items}</ul>
  </div>
</section>'''


def page_hero(root: str, p: dict) -> str:
    if p['slug'].startswith('nganh/'):
        return industry_hero(root, p)
    if p.get('cover'):
        return feature_cover(root, p)
    if p['slug'].startswith('tinh-nang/'):
        return feature_hero(root, p)
    crumbs = f'<a href="{href(root, "")}">Rapiz</a>'
    if p.get('group'):
        crumbs += f' <span aria-hidden="true">/</span> {p["group"]}'
    actions = (
        f'<a class="btn primary" href="{href(root, "#solutions")}">Thử hội thoại <span aria-hidden="true">↗</span></a>'
        f'<a class="text-link" href="{href(root, "dat-lich-demo")}{p.get("demo_query", "")}">Đặt lịch demo <span aria-hidden="true">→</span></a>'
    )
    if p.get('hero_actions') is False:
        actions = ''
    points = ''
    if p.get('points'):
        points = '<ul class="hero-points">' + ''.join(f'<li>{x}</li>' for x in p['points']) + '</ul>'
    visual = ''
    v = p.get('visual')
    if v:
        card = ''
        if v.get('card'):
            small, strong = v['card']
            card = (
                f'<p class="float-card"><span class="receipt-mark"><img src="{root}images/rapiz-symbol-faceted.svg" width="26" height="22" alt=""></span>'
                f'<span><small>{small}</small><strong>{strong}</strong></span></p>'
            )
        if v.get('mock'):
            visual = f'<div class="page-visual">{render_mock(root, v["mock"])}</div>'
        else:
            cls = 'page-visual shot' if v.get('shot') else 'page-visual'
            visual = (
                f'<figure class="{cls}"><img src="{root}images/{v["img"]}" alt="{escape(v.get("alt", ""))}" '
                f'width="{v.get("w", 960)}" height="{v.get("h", 1080)}" fetchpriority="high">{card}</figure>'
            )
    solo = '' if visual else ' solo'
    return f'''<section class="page-hero{solo}" aria-labelledby="page-title">
  <div class="accel" aria-hidden="true"><span></span><span></span><span></span></div>
  <div class="container">
    <div>
      <div class="kicker crumbs"><i class="slashes" aria-hidden="true"></i> {crumbs}</div>
      <h1 id="page-title">{p["h1"]}</h1>
      <p class="deck">{p["deck"]}</p>
      <div class="hero-actions">{actions}</div>
      {points}
    </div>
    {visual}
  </div>
</section>'''


def sec_open(cls: str, label_id: str) -> str:
    return f'<section class="sec {cls}" aria-labelledby="{label_id}">\n  <div class="container">'


def sec_head(sid: str, k: str, h2: str, lead: str = '', solo: bool = False) -> str:
    if solo:
        lead_html = f'<p>{lead}</p>' if lead else ''
        return f'<div class="sec-head-solo">{kicker(k)}<h2 id="{sid}">{h2}</h2>{lead_html}</div>'
    lead_html = f'<p>{lead}</p>' if lead else '<p></p>'
    return f'<div class="section-intro"><div>{kicker(k)}<h2 id="{sid}">{h2}</h2></div>{lead_html}</div>'


def render_pains(root: str, block: dict, n: int) -> str:
    sid = f's{n}'
    cards = ''.join(
        f'<article class="pain"><b>{i + 1:02d}</b><h3>{c[0]}</h3><p>{c[1]}</p></article>'
        for i, c in enumerate(block['items'])
    )
    return f'''{sec_open("", sid)}
    {sec_head(sid, block["kicker"], block["h2"], block.get("lead", ""))}
    <div class="pain-grid below">{cards}</div>
  </div>
</section>'''


def render_thread_item(root: str, item: tuple) -> str:
    kind = item[0]
    step = f' data-step="{item[2]}"' if len(item) > 2 and item[2] is not None else ''
    if kind == 'c':
        return f'<p class="message customer"{step}>{item[1]}</p>'
    if kind == 'a':
        return f'<p class="message agent"{step}>{item[1]}</p>'
    if kind == 'l':
        return f'<p class="lookup"{step}><i aria-hidden="true"></i><span>{item[1]}</span></p>'
    if kind == 'r':
        return f'<p class="demo-result"{step}>{item[1]}</p>'
    if kind == 'order':
        return order_card(item[1]).replace('<div class="order-card"', f'<div class="order-card"{step}', 1)
    raise ValueError(kind)


def order_card(o: dict) -> str:
    rows = ''.join(f'<dt>{k}</dt><dd>{v}</dd>' for k, v in o['rows'])
    return (
        f'<div class="order-card"><p>{o.get("title", "Tóm tắt đơn")}</p><dl>{rows}'
        f'<dt class="total">{o["total"][0]}</dt><dd class="total">{o["total"][1]}</dd></dl>'
        f'<div class="order-actions" aria-hidden="true"><span>{o.get("ok", "✅ Đặt hàng")}</span><span>{o.get("edit", "✏️ Sửa thông tin")}</span></div></div>'
    )


def render_player(root: str, block: dict, n: int) -> str:
    sid = f's{n}'
    steps = ''.join(f'<li>{s}</li>' for s in block['steps'])
    thread = '\n          '.join(render_thread_item(root, it) for it in block['thread'])
    return f'''{sec_open("tint", sid)}
    {sec_head(sid, block["kicker"], block["h2"], block.get("lead", ""))}
    <div class="playbox below" data-player>
      <div class="play-aside">
        <h3>{block["aside_title"]}</h3>
        <p>{block["aside"]}</p>
        <ol class="play-steps">{steps}</ol>
      </div>
      <div class="chat">
        <div class="chat-head"><span class="chat-avatar"><img src="{root}images/rapiz-symbol-faceted.svg" alt="" width="30" height="27"></span><div><strong>Rapiz Agent</strong><small>{block.get("channel", "Messenger")} · Hội thoại minh họa</small></div></div>
        <div class="chat-thread">
          {thread}
        </div>
        <div class="chat-controls"><button type="button" data-replay>Phát lại hội thoại <span aria-hidden="true">↻</span></button><span class="play-note">Tên, giá và lịch trong hội thoại là ví dụ.</span></div>
        <p class="sr-only" aria-live="polite" data-player-live></p>
      </div>
    </div>
  </div>
</section>'''


def render_mock(root: str, m: dict) -> str:
    kind = m['type']
    bar = f'<div class="mock-bar"><span>{m.get("title", "")}</span><small>{m.get("badge", "Minh họa")}</small></div>'
    if kind == 'shot':
        return (f'<figure class="mock">{bar}<div class="mock-shot"><img src="{root}images/{m["img"]}" alt="{escape(m["alt"])}" '
                f'width="2400" height="1345" loading="lazy" decoding="async"></div></figure>')
    if kind == 'chat':
        body = ''.join(render_thread_item(root, it) for it in m['thread'])
    elif kind == 'order':
        body = ''.join(render_thread_item(root, it) for it in m.get('before', [])) + order_card(m['order']) + \
            ''.join(render_thread_item(root, it) for it in m.get('after', []))
    elif kind == 'kv':
        rows = ''.join(f'<dt>{k}</dt><dd class="{c}">{v}</dd>' for k, v, c in m['rows'])
        body = f'<dl class="kv">{rows}</dl>'
        if m.get('foot'):
            body += f'<p class="mock-foot">{m["foot"]}</p>'
    elif kind == 'calc':
        rows = ''.join(f'<p class="{"hl" if hl else ""}"><span>{k}</span><span class="mono">{v}</span></p>' for k, v, hl in m['rows'])
        body = ''.join(render_thread_item(root, it) for it in m.get('before', [])) + f'<div class="calc">{rows}</div>'
        if m.get('foot'):
            body += f'<p class="mock-foot">{m["foot"]}</p>'
    elif kind == 'bars':
        top = max(v for _, v in m['bars'])
        bars = ''.join(
            f'<div><i style="--h:{round(v / top * 100)}%"><b>{v}</b></i><small>{k}</small></div>' for k, v in m['bars']
        )
        q = f'<p class="message customer">{m["question"]}</p>' if m.get('question') else ''
        body = f'{q}<p class="message agent">{m["answer"]}</p><div class="bars" role="img" aria-label="{escape(m["aria"])}">{bars}</div>'
    elif kind == 'comment':
        img = f'<img src="{root}images/{m["post_img"]}" alt="" width="56" height="56">'
        body = f'<div class="comment-post">{img}<p><strong>{m["page"]}</strong>{m["post"]}</p></div>'
        for c in m['comments']:
            who, name, text, note, extra = c
            avatar = f'<img src="{root}images/rapiz-symbol-faceted.svg" alt="">' if who == 'page' else name[0]
            cls = 'cmt page reply' if who == 'page' else f'cmt {extra}'.strip()
            note_html = f'<small>{note}</small>' if note else ''
            body += f'<div class="{cls}"><span aria-hidden="true">{avatar}</span><div><p><strong>{name}</strong>{text}</p>{note_html}</div></div>'
        if m.get('dm'):
            body += f'<p class="dm-note">✉ {m["dm"]}</p>'
    elif kind == 'list':
        lis = ''.join(
            f'<li><span aria-hidden="true">{a}</span><span>{t}<small>{s}</small></span><span class="pill {pc}">{pl}</span></li>'
            for a, t, s, pl, pc in m['items']
        )
        body = f'<ul class="list-mock">{lis}</ul>'
        if m.get('foot'):
            body += f'<p class="mock-foot">{m["foot"]}</p>'
    else:
        raise ValueError(kind)
    return f'<div class="mock">{bar}<div class="mock-body">{body}</div></div>'


def render_rows(root: str, block: dict, n: int) -> str:
    sid = f's{n}'
    rows = ''
    for i, r in enumerate(block['rows']):
        status = tag(r.get('status'))
        lst = ticks(r['ticks']) if r.get('ticks') else ''
        rows += f'''
      <article class="frow">
        <div class="frow-text"><p class="idx">{i + 1:02d}</p><h3>{r["title"]}{status}</h3><p>{r["text"]}</p>{lst}</div>
        {render_mock(root, r["mock"])}
      </article>'''
    return f'''{sec_open(block.get("cls", ""), sid)}
    {sec_head(sid, block["kicker"], block["h2"], block.get("lead", ""))}
    <div class="frows below">{rows}
    </div>
  </div>
</section>'''


def render_caps(root: str, block: dict, n: int) -> str:
    sid = f's{n}'
    cards = ''
    for c in block['items']:
        proof = f'<p class="proof">{c["proof"]}</p>' if c.get('proof') else ''
        inner = (f'<span class="cap-ico" aria-hidden="true">{C.ICONS[c["icon"]]}</span>'
                 f'<h3>{c["title"]}{tag(c.get("status"))}</h3><p>{c["text"]}</p>{proof}')
        if c.get('link'):
            cards += f'<a class="cap" href="{href(root, c["link"])}">{inner}</a>'
        else:
            cards += f'<article class="cap">{inner}</article>'
    return f'''{sec_open(block.get("cls", ""), sid)}
    {sec_head(sid, block["kicker"], block["h2"], block.get("lead", ""))}
    <div class="cap-grid below">{cards}</div>
  </div>
</section>'''


def render_steps(root: str, block: dict, n: int) -> str:
    sid = f's{n}'
    lis = ''.join(f'<li class="step"><h3>{s[0]}</h3><p>{s[1]}</p>{tag(s[2]) if len(s) > 2 else ""}</li>' for s in block['items'])
    return f'''{sec_open(block.get("cls", ""), sid)}
    {sec_head(sid, block["kicker"], block["h2"], block.get("lead", ""))}
    <ol class="steps below">{lis}</ol>
  </div>
</section>'''


def render_shot(root: str, block: dict, n: int) -> str:
    sid = f's{n}'
    return f'''{sec_open(block.get("cls", ""), sid)}
    {sec_head(sid, block["kicker"], block["h2"], block.get("lead", ""))}
    <figure class="tour-frame below" style="margin:clamp(30px,4vw,56px) 0 0">
      <img src="{root}images/{block["img"]}" width="{block.get("w", 2400)}" height="{block.get("h", 1345)}" loading="lazy" decoding="async" alt="{escape(block["alt"])}" style="display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:12px">
    </figure>
    <p class="fineprint">{block["caption"]}</p>
  </div>
</section>'''


def render_duo(root: str, block: dict, n: int) -> str:
    sid = f's{n}'
    cards = ''
    for c in block['cards']:
        body = ''
        if c.get('chips'):
            body = '<ul class="chip-list">' + ''.join(f'<li>{x}{tag(s)}</li>' for x, s in c['chips']) + '</ul>'
        if c.get('ticks'):
            body += ticks(c['ticks'])
        link = f'<a class="text-link" href="{href(root, c["link"][1])}">{c["link"][0]} <span aria-hidden="true">→</span></a>' if c.get('link') else ''
        cards += f'<article class="duo-card">{kicker(c["kicker"])}<h3>{c["title"]}</h3><p>{c["text"]}</p>{body}{link}</article>'
    return f'''{sec_open(block.get("cls", ""), sid)}
    {sec_head(sid, block["kicker"], block["h2"], block.get("lead", ""))}
    <div class="duo below">{cards}</div>
  </div>
</section>'''


def render_faq(root: str, block: dict, n: int) -> str:
    items = ''.join(
        f'<details{" open" if i == 0 else ""}><summary>{q}</summary><p>{a}</p></details>'
        for i, (q, a) in enumerate(block['items'])
    )
    return f'''<section id="questions" class="faq" aria-labelledby="faq-title">
  <div class="container faq-grid">
    <div>{kicker(block.get("kicker", "CÂU HỎI THƯỜNG GẶP"))}<h2 id="faq-title">{tie(block.get("h2", "Bạn muốn<br>biết <em>thêm?</em>"))}</h2></div>
    <div class="faq-items">{items}</div>
  </div>
</section>'''


def render_related(root: str, block: dict, n: int) -> str:
    if block.get('compact'):
        links = ''.join(f'<a href="{href(root, slug)}">{C.LINK_INDEX[slug]["name"]} <span aria-hidden="true">↗</span></a>'
                        for slug in block['slugs'])
        return f'<nav class="fe-related" aria-label="Tìm hiểu thêm"><div class="container"><strong>Tìm hiểu thêm</strong>{links}</div></nav>'
    sid = f's{n}'
    cards = ''
    for slug in block['slugs']:
        info = C.LINK_INDEX[slug]
        cards += (f'<a class="rel" href="{href(root, slug)}"><small>{info["group"]}</small><strong>{info["name"]}</strong>'
                  f'<span>{info["blurb"]}</span><em>Xem chi tiết →</em></a>')
    return f'''{sec_open("tint", sid)}
    {sec_head(sid, block.get("kicker", "XEM TIẾP"), block["h2"], "", solo=True)}
    <div class="related below">{cards}</div>
  </div>
</section>'''


def plan_context(p: dict) -> str:
    """What a visitor looking at a plan card sees, for the website chat bot (every term's price)."""
    if p['prices']:
        terms = ', '.join(f'{C.vnd(p["prices"][m])} khi trả {m} tháng' for m in ('12', '6', '3'))
        price = f'Giá mỗi tháng: {terms}.'
    else:
        price = 'Giá 0đ, không thời hạn, không cần thẻ thanh toán.'
    return f'Gói {p["name"]}: {p["for"]} {price} ' + '; '.join(p['ticks']) + '.'


def plan_cards(root: str) -> str:
    cards = ''
    for p in C.PLANS:
        featured = ' featured' if p.get('featured') else ''
        badge = f'<span class="badge">{p["badge"]}</span>' if p.get('badge') else ''
        if p['prices']:
            data = f' data-prices=\'{json.dumps(p["prices"])}\''
            low = min(p['prices'].values())
            price = (f'<p class="price"><b data-price>{C.vnd(p["prices"]["12"])}</b><span>/ tháng</span></p>'
                     f'<p class="price-note" data-price-note>Thanh toán {C.vnd(p["prices"]["12"] * 12)} cho 12 tháng</p>')
            cta_cls = 'btn primary' if p.get('featured') else 'btn ghost'
            cta = f'<a class="{cta_cls}" href="{href(root, "dat-lich-demo")}?goi={p["code"]}">{p["cta"]} <span aria-hidden="true">→</span></a>'
        else:
            data = ''
            price = '<p class="price"><b>0đ</b><span>/ không thời hạn</span></p><p class="price-note">Không cần thẻ thanh toán</p>'
            cta = f'<a class="btn ghost" href="{href(root, "dat-lich-demo")}?goi=free">{p["cta"]} <span aria-hidden="true">→</span></a>'
        cards += f'''<article class="plan{featured}"{data} data-rapiz-section="plan-{p["code"]}" data-rapiz-context="{escape(plan_context(p))}">{badge}
        <h3>{p["name"]}</h3><p class="for">{p["for"]}</p>{price}{cta}{ticks(p["ticks"])}
      </article>'''
    return cards


def term_toggle(target: str) -> str:
    opts = ''
    for months, save in C.TERMS:
        checked = ' checked' if months == '12' else ''
        badge = f' <small>{save}</small>' if save else ''
        opts += f'<label><input type="radio" name="term" value="{months}"{checked}><span>{months} tháng{badge}</span></label>'
    return f'<fieldset class="term-toggle" data-terms="{target}"><legend>Kỳ thanh toán</legend>{opts}</fieldset>'


def render_plans(root: str, block: dict, n: int) -> str:
    sid = f's{n}'
    more = (f'<a class="text-link more-link" href="{href(root, "bang-gia")}">So sánh đầy đủ các gói <span aria-hidden="true">→</span></a>'
            if block.get('more') else '')
    return f'''{sec_open(block.get("cls", ""), sid)}
    {sec_head(sid, block["kicker"], block["h2"], block.get("lead", ""))}
    <div class="below">
      <div class="plans-top">{term_toggle("#plans-" + str(n))}<p>Giá mỗi tháng theo kỳ thanh toán, chuyển khoản VietQR.</p></div>
      <div class="plans" id="plans-{n}">{plan_cards(root)}</div>
      <p class="plans-foot">{C.PLANS_FOOT}</p>
      {more}
    </div>
  </div>
</section>'''


def render_compare(root: str, block: dict, n: int) -> str:
    head = ''.join(f'<th scope="col">{p["name"]}</th>' for p in C.PLANS)
    body = ''
    for row in C.COMPARE:
        if isinstance(row, str):
            body += f'<tr class="group"><th scope="rowgroup" colspan="{len(C.PLANS) + 1}">{row}</th></tr>'
            continue
        label, *vals = row
        cells = ''
        for v in vals:
            if v is True:
                cells += '<td class="yes"><span aria-hidden="true">✓ </span>Có</td>'
            elif v is False:
                cells += '<td class="no">Không</td>'
            else:
                cells += f'<td>{v}</td>'
        body += f'<tr><th scope="row">{label}</th>{cells}</tr>'
    return f'''<section id="compare-plans" class="sec" aria-label="Bảng so sánh các gói">
  <div class="container">
    <div class="table-wrap"><table class="compare"><caption>So sánh chi tiết</caption><thead><tr><th scope="col">Hạn mức và tính năng</th>{head}</tr></thead><tbody>{body}</tbody></table></div>
  </div>
</section>'''


def render_form(root: str, block: dict, n: int) -> str:
    industries = ''.join(f'<option value="{v}">{t}</option>' for v, t in C.FORM_INDUSTRIES)
    plans = ''.join(f'<option value="{v}">{t}</option>' for v, t in C.FORM_PLANS)
    channels = ''.join(f'<label><input type="checkbox" name="channels" value="{c}"><span>{c}</span></label>' for c in C.FORM_CHANNELS)
    return f'''<section class="ut-intake" aria-labelledby="page-title"><div class="container ut-intake-layout">
      <div class="ut-brief">
        {kicker("BUỔI DEMO RIÊNG")}
        <h1 id="page-title">Mang một câu hỏi<br><em>đến buổi demo.</em></h1>
        <p class="ut-deck">Chọn tình huống khách hay hỏi. Dùng danh mục, chính sách và cách tư vấn của đội bạn để phác thảo nội dung buổi demo.</p>
        <div class="ut-agenda"><div class="ut-time"><b>30</b><span>phút</span></div>
        <div><h2>Nội dung buổi demo</h2>{ticks(block["ticks"])}</div></div>
        <a class="ut-link" href="{C.LOGIN_URL}">Đã có tài khoản? Đăng nhập <span aria-hidden="true">↗</span></a>
      </div>
      <form id="demo-form" class="demo-form ut-demo-form" data-demo-form novalidate>
        <div class="ut-form-intro"><h2>Phiếu chuẩn bị demo</h2><p data-brief-info>Điền thử để xem trước phiếu trên thiết bị của bạn.</p></div>
        <div class="field"><label for="f-name">Họ và tên</label><input id="f-name" name="name" autocomplete="name" required aria-describedby="f-name-err"><p class="err" id="f-name-err" aria-live="polite"></p></div>
        <div class="field"><label for="f-phone">Số điện thoại / Zalo</label><input id="f-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required aria-describedby="f-phone-err"><p class="err" id="f-phone-err" aria-live="polite"></p></div>
        <div class="field"><label for="f-email">Email <span>(tùy chọn)</span></label><input id="f-email" name="email" type="email" autocomplete="email" aria-describedby="f-email-err"><p class="err" id="f-email-err" aria-live="polite"></p></div>
        <div class="field"><label for="f-business">Doanh nghiệp / fanpage</label><input id="f-business" name="business" autocomplete="organization" required aria-describedby="f-business-err"><p class="err" id="f-business-err" aria-live="polite"></p></div>
        <div class="field"><label for="f-industry">Ngành kinh doanh</label><select id="f-industry" name="industry" required aria-describedby="f-industry-err"><option value="">Chọn ngành</option>{industries}</select><p class="err" id="f-industry-err" aria-live="polite"></p></div>
        <div class="field"><label for="f-plan">Gói quan tâm <span>(tùy chọn)</span></label><select id="f-plan" name="plan">{plans}</select></div>
        <fieldset class="field full"><legend>Kênh bạn đang bán hàng</legend><div class="check-chips">{channels}</div></fieldset>
        <div class="field full"><label for="f-note">Tình huống muốn xem <span>(tùy chọn)</span></label><textarea id="f-note" name="note" rows="3" placeholder="Ví dụ: khách hỏi phòng trống cho hai đêm cuối tuần."></textarea></div>
        <div class="form-actions"><noscript>Bật JavaScript để xem trước phiếu.</noscript><button class="btn primary" type="submit" disabled>Xem trước phiếu <span aria-hidden="true">→</span></button></div>
        <div class="form-done" hidden tabindex="-1">
          <strong>Phiếu demo của <span data-done-name></span></strong>
          <p data-brief-state role="status">Bản xem trước trên thiết bị. Chưa gửi yêu cầu hoặc đặt lịch.</p>
          <dl data-brief-summary></dl>
          <button type="button" class="btn primary" data-brief-send hidden>Gửi yêu cầu demo</button>
          <button type="button" class="btn ghost" data-brief-edit>Chỉnh sửa phiếu</button>
        </div>
      </form>
    </div></section>'''


RENDERERS = {
    'pains': render_pains,
    'player': render_player,
    'rows': render_rows,
    'caps': render_caps,
    'steps': render_steps,
    'shot': render_shot,
    'duo': render_duo,
    'faq': render_faq,
    'related': render_related,
    'inspect': render_inspect,
    'more': render_more,
    'demo': lambda root, block, n: template(block['template'], root=root, number=n),
    'plans': render_plans,
    'compare': render_compare,
    'form': render_form,
}


# The website chat bot reads `data-rapiz-section` on what the visitor sees (docs/07, website chat).
SECTION_NAMES = {
    'player': 'demo-chat', 'rows': 'details', 'caps': 'capabilities', 'shot': 'screenshot',
    'duo': 'details', 'compare': 'plan-compare', 'form': 'demo-form', 'catalog': 'channels',
}


def mark(html: str, section: str) -> str:
    """Names the block's first <section> for the website chat bot's page context."""
    return html.replace('<section ', f'<section data-rapiz-section="{section}" ', 1) if section else html


def section_name(block: dict) -> str:
    return block.get('section') or SECTION_NAMES.get(block['kind'], block['kind'])


# ---------- commercial and platform pages ----------

UTILITY_PAGES = {'bang-gia', 'dat-lich-demo', 'tich-hop', 'bao-mat'}


def utility_hero(root: str, page: dict) -> str:
    slug = page['slug']
    if slug == 'dat-lich-demo':
        return ''
    if slug == 'bang-gia':
        title = 'Một người hay<br><em>cả đội sale?</em>'
        label = 'BẢNG GIÁ'
        target, action = '#compare-plans', 'Xem bảng so sánh'
        seats = next(row[1:] for row in C.COMPARE if isinstance(row, tuple) and row[0] == 'Thành viên')
        # One small figure per seat: the owner in orange, the team in sand. The crowd grows plan by plan.
        rows, k = [], 0
        for plan, seat in zip(C.PLANS, seats):
            people = ''
            for i in range(int(seat)):
                people += f'<i style="--d:{k}"></i>'
                k += 1
            price = f'từ {C.vnd(plan["prices"]["12"])}/tháng' if plan['prices'] else '0đ'
            rows.append(f'<li><div><b>{plan["name"]}</b><small><span>{seat} thành viên ·</span> <span>{price}</span></small></div>'
                        f'<span class="ut-crowd" aria-hidden="true">{people}</span></li>')
        visual = f'''<figure class="ut-team" aria-label="Số thành viên dùng chung app theo từng gói">
          <figcaption><span>Ai cùng trả lời khách</span><span class="ut-team-key" aria-hidden="true"><i class="is-owner"></i>Bạn<i></i>Đội sale</span></figcaption>
          <ul>{''.join(rows)}</ul>
          <p class="ut-team-note">Giá mỗi tháng khi trả theo năm.</p>
        </figure>'''
    elif slug == 'tich-hop':
        title = 'Nơi khách nhắn.<br><em>Nơi bạn bán.</em>'
        label = 'DANH MỤC TÍCH HỢP'
        target, action = '#channels', 'Xem trạng thái các kênh'
        # Architecture diagram (diagram-design): channels → Rapiz → shop data, wide and portrait variants.
        visual = (SITE / 'tools/templates/integration-map.html').read_text(encoding='utf-8')
    else:
        title = 'Quyền truy cập,<br><em>trong tầm tay.</em>'
        label = 'BẢO MẬT & DỮ LIỆU'
        target, action = '#security-controls', 'Xem các lớp bảo vệ'
        visual = f'''<figure class="ut-security-visual"><div class="ut-vault">
          <div class="ut-vault-top"><span>Không gian doanh nghiệp</span><span aria-hidden="true">{C.ICONS["shield"]}</span></div>
          <div class="ut-vault-symbol" aria-hidden="true"><i></i><i></i><img src="{root}images/rapiz-symbol-faceted.svg" width="96" height="83" alt=""></div>
          <p>Dữ liệu tách riêng cho từng doanh nghiệp</p>
        </div></figure>'''
    return f'''<section class="ut-hero" aria-labelledby="page-title"><div class="container ut-hero-layout">
      <div>{kicker(label)}<h1 id="page-title">{title}</h1><p class="ut-deck">{page["deck"]}</p>
        <a href="{target}" class="ut-link">{action} <span aria-hidden="true">↓</span></a>
      </div>{visual}
    </div></section>'''


def utility_catalog(root: str, block: dict, n: int) -> str:
    rows = []
    for item in block['items']:
        title = item['title']
        if item.get('link'):
            title = f'<a href="{href(root, item["link"])}">{title} <span aria-hidden="true">↗</span></a>'
        status = item.get('status') or 'Đang hoạt động'
        if 'status' not in item:
            status_cls = 'live'
        elif status == 'Sắp ra mắt':
            status_cls = 'upcoming'
        elif status.startswith('Gói'):
            status_cls = 'tier'
        else:
            status_cls = 'beta'
        rows.append(f'''<li><span class="ut-channel-icon{' is-brand' if 'brand' in item else ''}" aria-hidden="true">{C.BRAND_ICONS[item["brand"]] if 'brand' in item else C.ICONS[item["icon"]]}</span>
          <h3>{title}</h3><p>{item["text"]}</p><span class="ut-status {status_cls}">{status}</span></li>''')
    anchor = f' id="{block["id"]}"' if block.get('id') else ''
    return f'''<section class="sec ut-catalog {block.get("cls", "")}"{anchor} aria-labelledby="s{n}"><div class="container">
      <div class="ut-index-head"><div>{kicker(block["kicker"])}<h2 id="s{n}">{block["h2"]}</h2></div>
      <p>{block.get("lead", "")}</p></div>
      <ul class="ut-channel-list">{''.join(rows)}</ul>
    </div></section>'''


def utility_controls(root: str, block: dict, n: int) -> str:
    cells = ''.join(f'''<article><div class="ut-control-icon" aria-hidden="true">{C.ICONS[item["icon"]]}</div>
      <div><h3>{item["title"]}</h3><p>{item["text"]}</p></div></article>''' for item in block['items'])
    return f'''<section class="sec ut-controls" id="{"security-controls" if n == 1 else "bot-controls"}" aria-labelledby="s{n}"><div class="container ut-control-layout">
      <div>{kicker(block["kicker"])}<h2 id="s{n}">{block["h2"]}</h2></div>
      <div class="ut-control-list">{cells}</div>
    </div></section>'''


def render_utility_page(p: dict, root: str) -> str:
    slug = p['slug']
    overrides = {
        'tich-hop': {'catalog': utility_catalog},
        'bao-mat': {'caps': utility_controls},
    }.get(slug, {})
    blocks = []
    for n, block in enumerate(p['blocks'], 1):
        if block['kind'] == 'close':
            continue  # The shared footer renders the page-specific closing message.
        renderer = overrides.get(block['kind']) or RENDERERS[block['kind']]
        name = 'security-controls' if slug == 'bao-mat' and block['kind'] == 'caps' else section_name(block)
        blocks.append(mark(renderer(root, block, n), name))
    description = 'Chuẩn bị nội dung buổi demo 30 phút và xem trước phiếu theo ngành, gói và kênh của doanh nghiệp.' if slug == 'dat-lich-demo' else p['description']
    return f'''{head(root, p["title"], description, slug + "/")}
{header(root, slug)}
<main id="main" class="ut-page ut-{slug}">{mark(utility_hero(root, p), "hero")}{"".join(blocks)}</main>
{footer(root, p)}
</body></html>
'''


def template(name: str, **values: str | int) -> str:
    return (SITE / 'tools' / 'templates' / name).read_text(encoding='utf-8').format(**values)


def render_page(p: dict) -> str:
    depth = p['slug'].count('/') + 1
    root = rel(depth)
    if p['slug'] == 've-rapiz':
        return f'''{head(root, p["title"], p["description"], "ve-rapiz/")}
{header(root, p["slug"])}
<main class="os-page" id="main">{template("about.html", root=root)}</main>
{footer(root, p)}
</body></html>
'''
    if p['slug'] in UTILITY_PAGES:
        return render_utility_page(p, root)
    blocks = []
    for n, b in enumerate(p['blocks'], start=1):
        if b['kind'] == 'close':
            continue
        fn = RENDERERS[b['kind']]
        blocks.append(mark(fn(root, b, n), section_name(b)))
    body = '\n'.join(blocks)
    return f'''{head(root, p["title"], p["description"], p["slug"] + "/", p.get("assets"))}
{header(root, p["slug"])}
<main id="main">
{mark(page_hero(root, p), "hero")}
{body}
</main>
{footer(root, p)}
</body></html>
'''


def replace_block(text: str, name: str, html: str) -> str:
    pattern = re.compile(rf'<!--#{name}-->.*?<!--/{name}-->', re.S)
    if not pattern.search(text):
        raise SystemExit(f'index.html is missing the <!--#{name}--> marker')
    return pattern.sub(lambda _: html, text)


def agent_loop(root: str) -> str:
    section = (SITE / 'tools/templates/agent-loop.html').read_text(encoding='utf-8')
    weave = (SITE / 'tools/templates/agent-weave.svg').read_text(encoding='utf-8')
    return section.replace('{{root}}', root).replace('{{weave}}', weave)


def build_agent_loop() -> None:
    path = ROOT / 'index.html'
    markup = f'<!--#agent-loop-->{agent_loop("")}<!--/agent-loop-->'
    path.write_text(replace_block(path.read_text(encoding='utf-8'), 'agent-loop', markup), encoding='utf-8')


def main() -> None:
    for p in C.PAGES:
        out = ROOT / p['slug'] / 'index.html'
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(render_page(p), encoding='utf-8')
        print('wrote', out.relative_to(ROOT))
    if os.environ.get('SKIP_INDEX'):
        print('skipped index.html (SKIP_INDEX)')
        return
    build_agent_loop()
    index = ROOT / 'index.html'
    text = index.read_text(encoding='utf-8')
    text = replace_block(text, 'site-head', header(''))
    text = replace_block(text, 'site-foot', footer(''))
    text = replace_block(text, 'plans', f'<!--#plans-->{term_toggle("#home-plans")}<!--/plans-->')
    text = replace_block(text, 'plan-cards', f'<!--#plan-cards--><div class="plans" id="home-plans">{plan_cards("")}</div><!--/plan-cards-->')
    index.write_text(text, encoding='utf-8')
    print('updated index.html')


if __name__ == '__main__':
    main()
