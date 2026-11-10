import { CSS } from './styles.js';
import { showPhoneChip, type LocalMessage, type State } from './state.js';
import type { Strings } from './strings.js';
import type { WidgetConfig } from './types.js';

export interface ViewHandlers {
  onToggle(open: boolean): void;
  onSend(text: string): void;
  onPickImage(file: File): void;
  onRetry(id: string): void;
  onPhoneChip(): void;
  onPhoneSubmit(raw: string): void;
  onPhoneCancel(): void;
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

  const chip = el('button', 'chip', config.phoneChipText);
  chip.type = 'button';
  chip.hidden = true;

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
  composer.append(file, field);

  // Phone composer
  const phoneForm = el('form', 'phoneform');
  phoneForm.hidden = true;
  const hint = el('p', 'hint', config.phonePrompt);
  const phoneInput = el('input');
  phoneInput.type = 'tel';
  phoneInput.autocomplete = 'tel';
  phoneInput.placeholder = strings.phonePlaceholder;
  phoneInput.setAttribute('aria-label', strings.phonePlaceholder);
  const phoneSend = el('button', 'send text', strings.phoneSend);
  phoneSend.type = 'submit';
  const phoneCancel = el('button', 'link', strings.phoneCancel);
  phoneCancel.type = 'button';
  const phoneErr = el('p', 'err');
  phoneErr.hidden = true;
  phoneErr.setAttribute('role', 'alert');
  phoneForm.append(hint, phoneInput, phoneSend, phoneCancel, phoneErr);

  panel.append(head, list, notice, chip, composer, phoneForm);
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

  const nodes = new Map<string, HTMLElement>();
  const buildNode = (m: LocalMessage): HTMLElement => {
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
      nodes.forEach((node, id) => {
        if (!live.has(id)) {
          node.remove();
          nodes.delete(id);
        }
      });
      let added = false;
      let cursor: ChildNode | null = list.firstChild;
      for (const m of s.messages) {
        let node = nodes.get(m.id);
        if (!node) {
          node = buildNode(m);
          nodes.set(m.id, node);
          added = true;
        }
        syncNode(node, m);
        if (node === cursor) cursor = cursor.nextSibling;
        else list.insertBefore(node, cursor);
      }
      if (list.lastChild !== typing) list.appendChild(typing);
      if (added && (nearBottom || s.messages.length < 3)) list.scrollTop = list.scrollHeight;
      typing.hidden = !s.botTyping;

      const phoneMode = s.inputMode === 'phone';
      composer.hidden = phoneMode;
      phoneForm.hidden = !phoneMode;
      phoneCancel.hidden = s.phoneRequired;
      chip.hidden = !showPhoneChip(s);
    },
    setNotice(text) {
      notice.hidden = !text;
      notice.textContent = text ?? '';
    },
    setPhoneError(text) {
      phoneErr.hidden = !text;
      phoneErr.textContent = text ?? '';
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
