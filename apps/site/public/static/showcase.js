// The product gallery reads its captions and links directly from the six slides.
(() => {
  const room = document.querySelector('#inside .rg-room');
  if (!room) return;
  const deck = room.querySelector('.rg-deck');
  const cards = [...deck.querySelectorAll('[data-gallery-card]')];
  if (!cards.length) return;
  const element = name => room.querySelector('[data-gallery-' + name + ']');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const play = element('play');
  const tabs = room.querySelector('.rg-tabs');
  const note = element('note');
  const dwell = 5400;
  let current = 0, timer, visible = false, paused = false, touch, lastSwipe = -Infinity;
  const offscreen = new Set();

  function schedule() {
    clearTimeout(timer);
    play.hidden = reduced.matches;
    play.firstElementChild.textContent = paused ? '▷' : 'Ⅱ';
    play.setAttribute('aria-label', paused ? 'Tiếp tục tự lướt' : 'Tạm dừng tự lướt');
    const running = visible && !document.hidden && !paused && !reduced.matches;
    room.dataset.playing = String(running);
    if (running) timer = setTimeout(() => show(current + 1), dwell);
  }

  function show(index) {
    if (index !== current) room.classList.add('rg-moving');
    current = (index + cards.length) % cards.length;
    cards.forEach((card, i) => {
      const distance = (i - current + cards.length) % cards.length;
      const pos = distance > cards.length / 2 ? distance - cards.length : distance;
      // The screen on the back of the carousel changes sides out of view.
      card.classList.toggle('rg-rebase', offscreen.has(card) && Math.abs(pos) === 2);
      if (Math.abs(pos) > 2) offscreen.add(card); else offscreen.delete(card);
      card.dataset.pos = String(pos);
      card.setAttribute('aria-hidden', String(pos !== 0));
      card.querySelector('.rg-pick').hidden = pos === 0 || Math.abs(pos) > 2;
    });
    const card = cards[current];
    [...tabs.children].forEach((tab, i) => tab.setAttribute('aria-pressed', String(i === current)));
    const tab = tabs.children[current];
    if (tabs.contains(document.activeElement)) tab.focus();
    // On phones the tabs scroll sideways; keep the current one in view.
    if (tabs.scrollWidth > tabs.clientWidth) tabs.scrollTo({
      left: tabs.scrollLeft + tab.getBoundingClientRect().left - tabs.getBoundingClientRect().left - 18,
      behavior: reduced.matches ? 'auto' : 'smooth' });
    element('name').textContent = card.dataset.name;
    element('caption').textContent = card.dataset.caption;
    // '@name' in a note is a tool call, set in italics.
    note.replaceChildren(...(card.dataset.note || '').split(/@(\w+)/).map((part, i) =>
      i % 2 ? Object.assign(document.createElement('i'), { textContent: part }) : part));
    note.hidden = !card.dataset.note;
    element('link').href = card.dataset.href;
    element('link').textContent = card.dataset.link + ' ↗';
    element('full').href = card.querySelector('.rg-shot').getAttribute('src');
    element('full').setAttribute('aria-label', 'Xem ảnh lớn: ' + card.dataset.name + ' (mở tab mới)');
    schedule();
  }

  tabs.append(...cards.map((card, i) => {
    const tab = Object.assign(document.createElement('button'), { type: 'button', textContent: card.dataset.name });
    tab.addEventListener('click', () => { paused = true; show(i); });
    return tab;
  }));
  element('next').addEventListener('click', () => show(current + 1));
  element('prev').addEventListener('click', () => show(current - 1));
  play.addEventListener('click', () => { paused = !paused; schedule(); });
  cards.forEach((card, i) => card.querySelector('.rg-pick').addEventListener('click', () => {
    if (performance.now() - lastSwipe > 400) show(i);
  }));
  room.addEventListener('keydown', event => {
    const move = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!move || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    paused = true;
    show(current + move);
  });
  room.addEventListener('focusin', event => {
    if (event.target.matches('a:focus-visible')) { paused = true; schedule(); }
  });
  deck.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
    clearTimeout(timer);
  });
  deck.addEventListener('pointerup', event => {
    if (!touch || touch.id !== event.pointerId) return;
    const dx = event.clientX - touch.x, dy = event.clientY - touch.y;
    touch = undefined;
    if (Math.abs(dx) > 36 && Math.abs(dx) > 1.3 * Math.abs(dy)) {
      lastSwipe = performance.now();
      show(current + (dx < 0 ? 1 : -1));
    } else schedule();
  });
  deck.addEventListener('pointercancel', () => { touch = undefined; schedule(); });
  document.addEventListener('visibilitychange', schedule);
  reduced.addEventListener('change', schedule);
  room.classList.add('rg-ready');
  room.querySelector('.rg-actions').hidden = false;
  tabs.hidden = false;
  show(0);
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && entry.intersectionRatio >= .28;
    if (visible) cards.forEach(card => { card.querySelector('.rg-shot').loading = 'eager'; });
    schedule();
  }, { threshold: [0, .28] });
  observer.observe(deck);
})();
