// Motion layer: hero entrance and live receipt, heading line rise, customer-voice marquee,
// scroll-driven kinetic band, spotlight tour over the real inbox, acceleration wipe between screens.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = 'cubic-bezier(.2,.7,.2,1)';
  const splitLines = el => {
    const parts = el.innerHTML.split(/<br\s*\/?>/i);
    el.innerHTML = parts.map(p => `<span class="ln"><span>${p.trim()}</span></span>`).join('');
  };

  /* ---------- hero ---------- */
  const hero = document.querySelector('.hero');
  const h1 = hero && hero.querySelector('h1');
  if (hero && h1) {
    splitLines(h1);
    if (!reduce) {
      h1.querySelectorAll('.ln > span').forEach((line, i) => line.animate(
        [{ transform: 'translateY(105%)' }, { transform: 'none' }],
        { duration: 950, delay: 120 + i * 90, easing: ease, fill: 'backwards' }
      ));
      const streaks = document.createElement('div');
      streaks.className = 'hero-streaks';
      streaks.setAttribute('aria-hidden', 'true');
      streaks.innerHTML = '<i style="top:31%"></i><i style="top:33.6%;width:26vw;opacity:.55"></i><i style="top:36%;width:15vw;opacity:.3"></i>';
      hero.prepend(streaks);
      streaks.querySelectorAll('i').forEach((bar, i) => bar.animate(
        [{ transform: 'skewX(-34deg) translateX(-130vw)' }, { transform: 'skewX(-34deg) translateX(190vw)' }],
        { duration: 1150, delay: i * 80, easing: 'cubic-bezier(.55,0,.75,.3)', fill: 'forwards' }
      ));
    }

    // live receipt: question -> lookup -> total -> confirmed
    const receipt = hero.querySelector('.hero-receipt');
    if (receipt) {
      const small = receipt.querySelector('small');
      const strong = receipt.querySelector('strong');
      const finalSmall = small.innerHTML;
      const steps = [
        ['Messenger · Khách hỏi', 'Áo sơ mi trắng còn size M?'],
        ['Rapiz Agent · Đã tra kho', 'Còn size M · 350.000đ'],
        ['Rapiz Agent · Chốt đơn', 'Gửi tóm tắt, chờ khách bấm xác nhận'],
        [finalSmall, 'Khách đã xác nhận đơn']
      ];
      const bar = document.createElement('span');
      bar.className = 'rc-bar';
      bar.innerHTML = '<b></b>';
      receipt.append(bar);
      receipt.classList.add('rc-live');
      let i = 0;
      const show = k => {
        receipt.classList.add('swap');
        setTimeout(() => {
          small.innerHTML = steps[k][0];
          strong.textContent = steps[k][1];
          receipt.classList.toggle('done', k === steps.length - 1);
          receipt.classList.remove('swap');
        }, reduce ? 0 : 220);
        if (!reduce) bar.firstChild.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
          { duration: k === steps.length - 1 ? 3600 : 1900, easing: 'linear', fill: 'forwards' });
      };
      if (reduce) {
        receipt.classList.add('done');
      } else {
        receipt.classList.remove('done');
        show(0);
        const tick = () => {
          show(++i);
          if (i < steps.length - 1) setTimeout(tick, 1900);
        };
        setTimeout(tick, 1900);
      }
    }
  }

  /* ---------- section headings rise line by line ---------- */
  const heads = [...document.querySelectorAll('main h2, .voices-title')];
  heads.forEach(splitLines);
  if (!reduce && 'IntersectionObserver' in window) {
    heads.forEach(h => h.classList.add('lr-ready'));
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('lr-in'); io.unobserve(e.target); }
    }), { threshold: .4 });
    heads.forEach(h => io.observe(h));
  }

  /* ---------- voices marquee ---------- */
  const voices = document.querySelector('.voices');
  if (voices && !reduce) {
    const list = voices.querySelector('.voices-list');
    const items = [...list.children];
    const half = Math.ceil(items.length / 2);
    const rows = [items.slice(0, half), items.slice(half)];
    list.innerHTML = '';
    rows.forEach(row => {
      const track = document.createElement('div');
      track.className = 'voices-track';
      row.forEach(li => track.append(li));
      for (let copy = 0; copy < 3; copy++) {
        row.forEach(li => { const c = li.cloneNode(true); c.setAttribute('aria-hidden', 'true'); track.append(c); });
      }
      list.append(track);
    });
    voices.classList.add('is-marquee');
  }

  /* ---------- kinetic band follows the scroll ---------- */
  const band = document.querySelector('.kinetic');
  if (band && !reduce) {
    const rows = [...band.querySelectorAll('.kinetic-row')];
    let ticking = false;
    const update = () => {
      ticking = false;
      const r = band.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight + r.height)));
      rows.forEach(row => {
        const dir = Number(row.dataset.dir);
        const x = dir < 0 ? -p * 34 : -34 + p * 34;
        row.style.transform = `translateX(${x}%)`;
      });
    };
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }

  /* ---------- spotlight tour over the real inbox ---------- */
  const inbox = document.querySelector('#rapiz-inbox');
  if (inbox) {
    const frame = inbox.querySelector('.tour-frame');
    const img = frame.querySelector('img');
    const wrap = document.createElement('span');
    wrap.className = 'spot-wrap';
    img.replaceWith(wrap);
    wrap.append(img);
    const ring = document.createElement('div');
    ring.className = 'spot-ring';
    ring.setAttribute('aria-hidden', 'true');
    ring.innerHTML = '<span></span>';
    wrap.append(ring);
    // regions in % of the screenshot (Mailisa demo conversation)
    const spots = [
      { l: 39.5, t: 23, w: 14, h: 4.6, label: '1 · Khách nhắn không dấu' },
      { l: 47.5, t: 28.6, w: 29.4, h: 12.6, label: '2 · Rapiz hỏi số điện thoại, cơ sở' },
      { l: 47.5, t: 68.4, w: 29.4, h: 10.4, label: '3 · Ghi nhận Thứ Bảy 07/11/2026' },
      { l: 79.5, t: 58.8, w: 19, h: 7.6, label: '4 · CRM: Yêu cầu đặt lịch' }
    ];
    const stepsEl = document.createElement('div');
    stepsEl.className = 'spot-steps';
    stepsEl.setAttribute('role', 'group');
    stepsEl.setAttribute('aria-label', 'Các bước trong hội thoại minh họa');
    stepsEl.innerHTML = spots.map(s => `<button type="button" aria-label="${s.label}"></button>`).join('');
    frame.after(stepsEl);
    const btns = [...stepsEl.children];
    const dur = 3000;
    stepsEl.style.setProperty('--dur', dur + 'ms');
    let k = 0, timer = null, visible = false, hover = false;
    const set = n => {
      k = n;
      const s = spots[n];
      Object.assign(ring.style, { left: s.l + '%', top: s.t + '%', width: s.w + '%', height: s.h + '%' });
      ring.firstChild.textContent = s.label;
      ring.classList.toggle('flip', s.l > 60);
      ring.classList.add('on');
      btns.forEach((b, j) => { b.classList.toggle('done', j < n); b.classList.remove('on'); });
      void btns[n].offsetWidth;
      if (!reduce) btns[n].classList.add('on'); else btns[n].classList.add('done');
    };
    const loop = () => {
      clearTimeout(timer);
      if (reduce || !visible || hover || inbox.hidden) return;
      timer = setTimeout(() => { set((k + 1) % spots.length); loop(); }, dur);
    };
    btns.forEach((b, j) => b.addEventListener('click', () => { set(j); loop(); }));
    frame.addEventListener('pointerenter', () => { hover = true; clearTimeout(timer); });
    frame.addEventListener('pointerleave', () => { hover = false; loop(); });
    set(0);
    new IntersectionObserver(es => es.forEach(e => { visible = e.isIntersecting; if (visible) { set(k); loop(); } else clearTimeout(timer); }),
      { threshold: .35 }).observe(frame);
  }

  /* ---------- acceleration wipe when switching tour screens ---------- */
  if (!reduce) {
    document.querySelectorAll('#platform .tour-panel').forEach(panel => {
      new MutationObserver(() => {
        if (panel.hidden) return;
        panel.classList.remove('wipe');
        void panel.offsetWidth;
        panel.classList.add('wipe');
        setTimeout(() => panel.classList.remove('wipe'), 900);
      }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    });
  }
})();
