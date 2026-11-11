import { CSS } from './styles.js';
import { showPhoneChip, type LocalMessage, type State } from './state.js';
import type { Strings } from './strings.js';
import type { MessageCard, MessageSuggestion, WidgetConfig } from './types.js';

export interface ViewHandlers {
  onToggle(open: boolean): void;
  onSend(text: string): void;
  onPickImage(file: File): void;
  onRetry(id: string): void;
  onPhoneChip(): void;
  onPhoneSubmit(raw: string): void;
  onPhoneCancel(): void;
  /** A suggested place on the site: a section of this page or another page (ADR-029). */
  onNavigate(url: string): void;
}

export interface View {
  host: HTMLElement;
  update(state: State): void;
  setNotice(text: string | null): void;
  setPhoneError(text: string | null): void;
  setBusy(busy: boolean): void;
  focusInput(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(path: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

const ICON_CHAT =
  'M5 3h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-7.6l-4.8 3.6A1 1 0 0 1 5 20.8V18a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm3 7.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm4 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm4 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z';
const ICON_CLOSE =
  'M6.7 5.3 12 10.6l5.3-5.3a1 1 0 1 1 1.4 1.4L13.4 12l5.3 5.3a1 1 0 0 1-1.4 1.4L12 13.4l-5.3 5.3a1 1 0 0 1-1.4-1.4l5.3-5.3-5.3-5.3a1 1 0 0 1 1.4-1.4z';
const ICON_SEND =
  'M12 4a1 1 0 0 1 .7.3l6 6a1 1 0 0 1-1.4 1.4L13 7.4V19a1 1 0 1 1-2 0V7.4l-4.3 4.3a1 1 0 0 1-1.4-1.4l6-6A1 1 0 0 1 12 4z';
const ICON_ARROW =
  'M13.3 5.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1 0 1.4l-6 6a1 1 0 0 1-1.4-1.4l4.3-4.3H4a1 1 0 1 1 0-2h13.6l-4.3-4.3a1 1 0 0 1 0-1.4z';
const ICON_OUT =
  'M8 6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 1 1-2 0V8.4L6.7 18.7a1 1 0 0 1-1.4-1.4L15.6 7H9a1 1 0 0 1-1-1z';
const ICON_CHEVRON =
  'M9.3 5.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1 0 1.4l-6 6a1 1 0 0 1-1.4-1.4l5.3-5.3-5.3-5.3a1 1 0 0 1 0-1.4z';
const ICON_PHONE =
  'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z';
const ICON_IMAGE =
  'M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const isHttp = (u: string): boolean => /^https?:\/\//i.test(u);

/** A URL of this very page with a fragment: following it scrolls instead of loading a page. */
export function sameDocument(url: string, href: string = window.location.href): boolean {
  try {
    const to = new URL(url, href);
    const here = new URL(href);
    const path = (u: URL): string => u.pathname.replace(/\/index\.html?$/, '/');
    return to.origin === here.origin && path(to) === path(here) && to.hash.length > 1;
  } catch {
    return false;
  }
}
const safeColor = (c: string): string => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : '#FF7A45');

/** Text colour on the brand colour: charcoal or white, whichever contrasts more (WCAG luminance). */
export function onColor(hex: string): string {
  let h = hex.slice(1);
  if (h.length <= 4) h = h.slice(0, 3).replace(/./g, (x) => x + x);
  const lum = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * (lum[0] ?? 0) + 0.7152 * (lum[1] ?? 0) + 0.0722 * (lum[2] ?? 0);
  return (l + 0.05) / 0.0637 >= 1.05 / (l + 0.05) ? '#1F1F1F' : '#FFFFFF';
}

export function createView(config: WidgetConfig, strings: Strings, h: ViewHandlers): View {
  const host = el('div');
  host.setAttribute('data-rapiz-widget', '');
  host.style.cssText = 'position:fixed;bottom:0;left:0;width:0;height:0;z-index:2147483000';
  const root: ShadowRoot | HTMLElement = host.attachShadow
    ? host.attachShadow({ mode: 'open' })
    : host;

  const style = el('style');
  style.textContent = CSS;
  const wrap = el('div', `root ${config.position === 'left' ? 'left' : 'right'}`);
  const color = safeColor(config.color);
  wrap.style.setProperty('--c', color);
  wrap.style.setProperty('--on-c', onColor(color));

  // Bubble
  const bubble = el('button', 'bubble');
  bubble.type = 'button';
  bubble.setAttribute('aria-label', strings.open);
  bubble.appendChild(icon(ICON_CHAT));
  const badge = el('span', 'badge');
  badge.hidden = true;
  bubble.appendChild(badge);

  // Panel
  const panel = el('section', 'panel');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', config.agentName);

  const head = el('div', 'head');
  let avatar: HTMLElement;
  if (config.avatarUrl && isHttp(config.avatarUrl)) {
    const img = el('img', 'avatar');
    img.src = config.avatarUrl;
    img.alt = '';
    avatar = img;
  } else {
    avatar = el('div', 'avatar', (config.agentName.charAt(0) || '?').toUpperCase());
  }
  const title = el('div', 'title');
  const name = el('div', 'name', config.agentName);
  const status = el('div', 'status', strings.status);
  title.append(name, status);
  const closeBtn = el('button', 'hbtn');
  closeBtn.appendChild(icon(ICON_CLOSE));
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', strings.close);
  head.append(avatar, title, closeBtn);

  const list = el('div', 'list');
  list.setAttribute('role', 'log');
  list.setAttribute('aria-live', 'polite');
  const typing = el('div', 'typing');
  typing.hidden = true;
  typing.setAttribute('role', 'status');
  typing.setAttribute('aria-label', strings.typing);
  typing.append(el('i'), el('i'), el('i'));

  const notice = el('div', 'notice');
  notice.hidden = true;
  notice.setAttribute('role', 'alert');

  // Phone chip: a pill above the text field, the way into the phone form.
  const chip = el('button', 'chip');
  chip.type = 'button';
  chip.hidden = true;
  const chipIcon = el('span', 'ci');
  chipIcon.appendChild(icon(ICON_PHONE));
  chip.append(chipIcon, el('span', '', config.phoneChipText), icon(ICON_ARROW));

  // Text composer
  const composer = el('form', 'composer');
  const file = el('input');
  file.type = 'file';
  file.accept = 'image/jpeg,image/png,image/webp,image/gif';
  file.hidden = true;
  const attach = el('button', 'ibtn');
  attach.type = 'button';
  attach.setAttribute('aria-label', strings.attach);
  attach.appendChild(icon(ICON_IMAGE));
  const input = el('textarea');
  input.rows = 1;
  input.maxLength = 2000;
  input.placeholder = strings.placeholder;
  input.setAttribute('aria-label', strings.placeholder);
  const send = el('button', 'send');
  send.type = 'submit';
  send.setAttribute('aria-label', strings.send);
  send.appendChild(icon(ICON_SEND));
  const field = el('div', 'field');
  field.append(attach, input, send);
  composer.append(chip, file, field);

  // Phone composer: the prompt, then the number in the same field as a message.
  const phoneForm = el('form', 'phoneform');
  phoneForm.hidden = true;
  const phoneHead = el('div', 'phead');
  const phoneBadge = el('span', 'ci');
  phoneBadge.appendChild(icon(ICON_PHONE));
  const hint = el('p', 'hint', config.phonePrompt);
  const phoneCancel = el('button', 'hbtn');
  phoneCancel.type = 'button';
  phoneCancel.setAttribute('aria-label', strings.phoneCancel);
  phoneCancel.appendChild(icon(ICON_CLOSE));
  phoneHead.append(phoneBadge, hint, phoneCancel);
  const phoneInput = el('input');
  phoneInput.type = 'tel';
  phoneInput.autocomplete = 'tel';
  phoneInput.inputMode = 'tel';
  phoneInput.placeholder = strings.phonePlaceholder;
  phoneInput.setAttribute('aria-label', strings.phonePlaceholder);
  const phoneSend = el('button', 'send');
  phoneSend.type = 'submit';
  phoneSend.setAttribute('aria-label', strings.phoneSend);
  phoneSend.appendChild(icon(ICON_ARROW));
  const phoneField = el('div', 'field');
  phoneField.append(phoneInput, phoneSend);
  const phoneErr = el('p', 'err');
  phoneErr.hidden = true;
  phoneErr.setAttribute('role', 'alert');
  phoneForm.append(phoneHead, phoneField, phoneErr);

  panel.append(head, list, notice, composer, phoneForm);
  wrap.append(bubble, panel);
  root.append(style, wrap);

  // Events
  let isOpen = false;
  const toggle = (open: boolean): void => h.onToggle(open);
  bubble.addEventListener('click', () => toggle(!isOpen));
  const closePanel = (): void => {
    toggle(false);
    bubble.focus();
  };
  closeBtn.addEventListener('click', closePanel);
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) closePanel();
  });
  chip.addEventListener('click', () => h.onPhoneChip());
  attach.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (f) h.onPickImage(f);
    file.value = '';
  });
  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    h.onSend(text);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      composer.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
  phoneForm.addEventListener('submit', (e) => {
    e.preventDefault();
    h.onPhoneSubmit(phoneInput.value);
  });
  phoneCancel.addEventListener('click', () => h.onPhoneCancel());

  /** A row of product cards; a card asks the bot about its product. */
  const buildCards = (cards: readonly MessageCard[]): HTMLElement => {
    const box = el('div', 'carousel');
    const row = el('div', 'cards');
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', strings.products);
    for (const c of cards) {
      const card = el('button', 'card');
      card.type = 'button';
      const pic = el('span', 'pic');
      pic.setAttribute('data-initial', (c.title.trim().charAt(0) || '•').toUpperCase());
      if (c.imageUrl && isHttp(c.imageUrl)) {
        const img = el('img');
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.addEventListener('load', () => pic.classList.add('ok'));
        img.addEventListener('error', () => img.remove());
        img.src = c.imageUrl;
        pic.appendChild(img);
      }
      const body = el('span', 'cb');
      body.append(el('span', 'ct', c.title));
      if (c.price) body.append(el('span', 'cp', c.price));
      const more = el('span', 'cm', strings.learnMore);
      const go = el('span', 'go');
      go.appendChild(icon(ICON_ARROW));
      more.appendChild(go);
      body.append(more);
      card.append(pic, body);
      card.addEventListener('click', () => h.onSend(strings.askAbout(c.title)));
      row.appendChild(card);
    }
    const step = (dir: number) => (): void =>
      row.scrollBy({ left: dir * (row.clientWidth - 48), behavior: 'smooth' });
    const prev = el('button', 'cnav prev');
    const next = el('button', 'cnav next');
    prev.type = next.type = 'button';
    prev.setAttribute('aria-label', strings.previous);
    next.setAttribute('aria-label', strings.next);
    prev.appendChild(icon(ICON_CHEVRON));
    next.appendChild(icon(ICON_CHEVRON));
    prev.addEventListener('click', step(-1));
    next.addEventListener('click', step(1));
    const edges = (): void => {
      prev.hidden = row.scrollLeft <= 4;
      next.hidden = row.scrollLeft + row.clientWidth >= row.scrollWidth - 4;
    };
    row.addEventListener('scroll', edges, { passive: true });
    box.append(row, prev, next);
    prev.hidden = next.hidden = true;
    requestAnimationFrame(edges);
    return box;
  };

  /** Follow-up buttons under the newest answer: a reply to send, or a place on the site to go. */
  const buildSuggestions = (items: readonly MessageSuggestion[]): HTMLElement => {
    const box = el('div', 'sugg');
    for (const s of items) {
      const b = el('button', `sg ${s.kind}`);
      b.type = 'button';
      b.append(el('span', '', s.kind === 'reply' ? s.text : s.title));
      if (s.kind === 'link') {
        const local = sameDocument(s.url);
        b.appendChild(icon(local ? ICON_ARROW : ICON_OUT));
        if (local) b.classList.add('down');
        b.addEventListener('click', () => h.onNavigate(s.url));
      } else {
        b.appendChild(icon(ICON_ARROW));
        b.addEventListener('click', () => h.onSend(s.text));
      }
      box.appendChild(b);
    }
    return box;
  };

  interface Entry {
    bubble: HTMLElement;
    all: HTMLElement[];
  }
  const nodes = new Map<string, Entry>();
  const buildNode = (m: LocalMessage): Entry => {
    const bubble = buildBubble(m);
    const all = m.text || m.imageUrl || !m.ui?.cards?.length ? [bubble] : [];
    if (m.role === 'agent' && m.ui?.cards?.length) all.push(buildCards(m.ui.cards));
    return { bubble, all };
  };
  let suggestion: { id: string; node: HTMLElement } | null = null;
  const buildBubble = (m: LocalMessage): HTMLElement => {
    const b = el('div');
    if (m.imageUrl && isHttp(m.imageUrl)) {
      const img = el('img');
      img.src = m.imageUrl;
      img.alt = '';
      img.loading = 'lazy';
      b.appendChild(img);
    }
    if (m.text) b.appendChild(document.createTextNode(m.text));
    b.addEventListener('click', () => {
      if (b.classList.contains('failed')) h.onRetry(m.id);
    });
    b.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && b.classList.contains('failed')) h.onRetry(m.id);
    });
    return b;
  };
  const syncNode = (b: HTMLElement, m: LocalMessage): void => {
    b.className = `msg ${m.role}${m.status === 'sent' ? '' : ` ${m.status}`}`;
    const note = b.querySelector('.note');
    if (m.status === 'failed') {
      if (!note) b.appendChild(el('span', 'note', strings.failed));
      b.setAttribute('role', 'button');
      b.tabIndex = 0;
    } else {
      if (note) note.remove();
      b.removeAttribute('role');
      b.removeAttribute('tabindex');
    }
  };

  const fit = (): void => {
    const v = window.visualViewport;
    if (v && window.innerWidth <= 640 && isOpen) {
      panel.style.height = `${v.height}px`;
      panel.style.top = `${v.offsetTop}px`;
      panel.style.bottom = 'auto';
      list.scrollTop = list.scrollHeight;
    } else {
      panel.style.height = '';
      panel.style.top = '';
      panel.style.bottom = '';
    }
  };
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fit);
    window.visualViewport.addEventListener('scroll', fit);
  }

  /** Runs a change that resizes the list (a notice, an error line) without losing the bottom. */
  const keepBottom = (change: () => void): void => {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    change();
    if (atBottom) list.scrollTop = list.scrollHeight;
  };

  const view: View = {
    host,
    update(s) {
      isOpen = s.open;
      panel.hidden = !s.open;
      wrap.classList.toggle('open', s.open);
      bubble.setAttribute('aria-expanded', String(s.open));
      badge.hidden = s.unread === 0;
      badge.textContent = s.unread > 9 ? '9+' : String(s.unread);
      fit();

      // Incremental render keyed by message id: existing nodes are updated in place.
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      const live = new Set<string>();
      for (const m of s.messages) live.add(m.id);
      nodes.forEach((entry, id) => {
        if (!live.has(id)) {
          entry.all.forEach((n) => n.remove());
          nodes.delete(id);
        }
      });
      // Suggestions belong to the newest message only, while it is an answer and nothing is coming.
      const last = s.messages[s.messages.length - 1];
      const offer =
        last && last.role === 'agent' && !s.botTyping && last.ui?.suggestions?.length ? last : null;
      let added = false;
      if (suggestion && suggestion.id !== offer?.id) {
        suggestion.node.remove();
        suggestion = null;
      }
      if (offer && !suggestion) {
        suggestion = { id: offer.id, node: buildSuggestions(offer.ui?.suggestions ?? []) };
        added = true;
      }
      let cursor: ChildNode | null = list.firstChild;
      const place = (node: HTMLElement): void => {
        if (node === cursor) cursor = cursor.nextSibling;
        else list.insertBefore(node, cursor);
      };
      for (const m of s.messages) {
        let entry = nodes.get(m.id);
        if (!entry) {
          entry = buildNode(m);
          nodes.set(m.id, entry);
          added = true;
        }
        syncNode(entry.bubble, m);
        entry.all.forEach(place);
      }
      if (suggestion) place(suggestion.node);
      if (list.lastChild !== typing) list.appendChild(typing);
      typing.hidden = !s.botTyping;

      const phoneMode = s.inputMode === 'phone';
      composer.hidden = phoneMode;
      phoneForm.hidden = !phoneMode;
      phoneCancel.hidden = s.phoneRequired;
      chip.hidden = !showPhoneChip(s);
      // Last, once the chip or the phone form has resized the list: a reader at the bottom stays there.
      if (nearBottom || (added && s.messages.length < 3)) list.scrollTop = list.scrollHeight;
    },
    setNotice(text) {
      keepBottom(() => {
        notice.hidden = !text;
        notice.textContent = text ?? '';
      });
    },
    setPhoneError(text) {
      keepBottom(() => {
        phoneErr.hidden = !text;
        phoneErr.textContent = text ?? '';
      });
    },
    setBusy(busy) {
      send.disabled = busy;
      phoneSend.disabled = busy;
    },
    focusInput() {
      (phoneForm.hidden ? input : phoneInput).focus();
    },
  };
  return view;
}
