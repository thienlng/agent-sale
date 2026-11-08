// Shared behaviour for every page: header menus, the step-by-step conversation player,
// pricing term switch, the measured funnel reveal and the demo request form.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- header: mobile menu and dropdown panels ---------- */
  const menuButton = document.querySelector('.nav-toggle');
  const menu = document.getElementById('nav');
  const triggers = [...document.querySelectorAll('.nav-trigger')];
  const closePanels = except => triggers.forEach(t => {
    if (t === except) return;
    t.setAttribute('aria-expanded', 'false');
    document.getElementById(t.getAttribute('aria-controls')).classList.remove('open');
  });
  const toggleMenu = open => {
    menu.classList.toggle('open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Đóng menu' : 'Mở menu');
    if (!open) closePanels();
  };
  if (menuButton && menu) {
    menuButton.addEventListener('click', () => toggleMenu(!menu.classList.contains('open')));
    menu.addEventListener('click', e => { if (e.target.closest('a')) toggleMenu(false); });
  }
  triggers.forEach(t => t.addEventListener('click', () => {
    const open = t.getAttribute('aria-expanded') !== 'true';
    closePanels(t);
    t.setAttribute('aria-expanded', String(open));
    document.getElementById(t.getAttribute('aria-controls')).classList.toggle('open', open);
  }));
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const openTrigger = triggers.find(t => t.getAttribute('aria-expanded') === 'true');
    if (openTrigger) { closePanels(); openTrigger.focus(); return; }
    if (menu && menu.classList.contains('open')) { toggleMenu(false); menuButton.focus(); }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.nav-group')) closePanels();
    if (menu && !e.target.closest('.site-head') && menu.classList.contains('open')) toggleMenu(false);
  });

  /* ---------- conversation player: replays a scripted, illustrative chat ---------- */
  document.querySelectorAll('[data-player]').forEach(box => {
    const thread = box.querySelector('.chat-thread');
    const items = [...thread.children];
    const steps = [...box.querySelectorAll('.play-steps li')];
    const button = box.querySelector('[data-replay]');
    const live = box.querySelector('[data-player-live]');
    let timers = [];
    let played = false;
    const markStep = n => steps.forEach((li, i) => {
      li.classList.toggle('done', i < n);
      li.classList.toggle('on', i === n);
    });
    const showAll = () => {
      items.forEach(el => { el.hidden = false; });
      markStep(steps.length);
    };
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    const play = () => {
      timers.forEach(clearTimeout);
      timers = [];
      played = true;
      items.forEach(el => { el.hidden = true; el.classList.remove('reveal'); });
      thread.querySelectorAll('.typing').forEach(el => el.remove());
      markStep(-1);
      let t = 300;
      items.forEach(el => {
        const agent = el.classList.contains('agent');
        const pause = el.classList.contains('customer') ? 900 : el.classList.contains('lookup') ? 650 : agent ? 500 : 700;
        t += pause;
        if (agent) {
          const dots = document.createElement('p');
          dots.className = 'message agent typing reveal';
          dots.setAttribute('aria-hidden', 'true');
          dots.innerHTML = '<i></i><i></i><i></i>';
          later(() => thread.insertBefore(dots, el), t);
          t += 1000;
          later(() => dots.remove(), t);
        }
        later(() => {
          el.hidden = false;
          el.classList.add('reveal');
          if (el.dataset.step !== undefined) markStep(Number(el.dataset.step));
          if (live && (agent || el.classList.contains('demo-result'))) live.textContent = el.textContent;
        }, t);
      });
      later(() => markStep(steps.length), t + 400);
    };
    if (button) button.addEventListener('click', () => (reduce ? showAll() : play()));
    if (reduce || !('IntersectionObserver' in window)) { showAll(); return; }
    items.forEach(el => { el.hidden = true; });
    new IntersectionObserver((entries, io) => entries.forEach(e => {
      if (e.isIntersecting && !played) { play(); io.disconnect(); }
    }), { threshold: .45 }).observe(box);
  });

  /* ---------- pricing: switch the billing term ---------- */
  const fmt = n => n.toLocaleString('vi-VN').replace(/,/g, '.');
  document.querySelectorAll('[data-terms]').forEach(group => {
    const scope = document.querySelector(group.dataset.terms);
    const apply = months => scope.querySelectorAll('[data-prices]').forEach(card => {
      const prices = JSON.parse(card.dataset.prices);
      const monthly = prices[months];
      card.querySelector('[data-price]').textContent = fmt(monthly) + 'đ';
      card.querySelector('[data-price-note]').textContent =
        `Thanh toán ${fmt(monthly * Number(months))}đ cho ${months} tháng`;
    });
    group.addEventListener('change', e => apply(e.target.value));
    const checked = group.querySelector('input:checked');
    if (checked) apply(checked.value);
  });

  /* ---------- measured funnel: bars grow once when seen ---------- */
  document.querySelectorAll('.measure').forEach(el => {
    if (!('IntersectionObserver' in window)) return;
    new IntersectionObserver((entries, io) => entries.forEach(e => {
      if (e.isIntersecting) { el.classList.add('in'); io.disconnect(); }
    }), { threshold: .35 }).observe(el);
  });

  /* ---------- demo request form ---------- */
  const form = document.querySelector('[data-demo-form]');
  if (form) {
    const params = new URLSearchParams(location.search);
    for (const [queryKey, fieldName] of [['nganh', 'industry'], ['goi', 'plan']]) {
      const value = params.get(queryKey);
      const field = form.elements[fieldName];
      if (value && [...field.options].some(option => option.value === value)) field.value = value;
    }
    const rules = {
      name: v => v.trim().length >= 2 || 'Vui lòng nhập họ tên.',
      phone: v => /^\+?\d{9,15}$/.test(v.trim().replace(/[ ().-]/g, '')) || 'Số điện thoại cần 9 đến 15 chữ số.',
      email: v => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) || 'Email chưa đúng định dạng.',
      business: v => v.trim().length >= 2 || 'Vui lòng nhập tên doanh nghiệp.',
      industry: v => !!v || 'Vui lòng chọn ngành.'
    };
    const check = field => {
      const rule = rules[field.name];
      if (!rule) return true;
      const result = rule(field.value);
      const err = document.getElementById(field.id + '-err');
      const ok = result === true;
      field.setAttribute('aria-invalid', String(!ok));
      if (err) err.textContent = ok ? '' : result;
      return ok;
    };
    form.addEventListener('blur', e => { if (rules[e.target.name] && e.target.value) check(e.target); }, true);
    const submit = form.querySelector('[type=submit]');
    submit.disabled = false;
    const preview = form.querySelector('.form-done');
    const send = preview.querySelector('[data-brief-send]');
    const edit = preview.querySelector('[data-brief-edit]');
    const state = preview.querySelector('[data-brief-state]');
    const endpoint = form.dataset.endpoint?.trim();
    if (endpoint) {
      form.querySelector('[data-brief-info]').textContent = 'Xem trước nội dung, sau đó chọn gửi yêu cầu demo đến Rapiz.';
      send.hidden = false;
    }
    form.addEventListener('submit', e => {
      e.preventDefault();
      const fields = Object.keys(rules).map(n => form.elements[n]);
      const bad = fields.filter(f => !check(f));
      if (bad.length) { bad[0].focus(); return; }

      const values = new FormData(form);
      const selections = [
        ['Doanh nghiệp', values.get('business')],
        ['Liên hệ', [values.get('phone'), values.get('email')].filter(Boolean).join(' · ')],
        ['Ngành', form.elements.industry.selectedOptions[0].textContent],
        ['Gói', form.elements.plan.selectedOptions[0].textContent],
        ['Kênh', values.getAll('channels').join(', ')],
        ['Tình huống', values.get('note')],
      ];
      const summary = preview.querySelector('[data-brief-summary]');
      summary.replaceChildren();
      for (const [label, value] of selections) {
        if (!value || !value.trim()) continue;
        const term = document.createElement('dt');
        const detail = document.createElement('dd');
        term.textContent = label;
        detail.textContent = value.trim();
        summary.append(term, detail);
      }
      preview.querySelector('[data-done-name]').textContent = values.get('name').trim();
      for (const child of form.children) child.hidden = child !== preview;
      if (endpoint) {
        state.textContent = 'Kiểm tra thông tin rồi gửi yêu cầu. Lịch hẹn sẽ được xác nhận riêng.';
        send.textContent = 'Gửi yêu cầu demo';
      }
      preview.focus();
    });
    send.addEventListener('click', async () => {
      if (!endpoint || send.disabled || send.hidden) return;
      send.disabled = true;
      edit.disabled = true;
      state.textContent = 'Đang gửi yêu cầu…';
      const fields = new FormData(form);
      const payload = {...Object.fromEntries(fields), channels: fields.getAll('channels')};
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Request rejected');
        send.hidden = true;
        edit.hidden = true;
        state.textContent = 'Rapiz đã nhận yêu cầu demo. Lịch hẹn chưa được xác nhận.';
        preview.focus();
      } catch {
        state.textContent = 'Chưa xác nhận được yêu cầu. Bạn có thể chỉnh sửa phiếu hoặc thử gửi lại.';
        send.textContent = 'Thử gửi lại';
        send.disabled = false;
        edit.disabled = false;
        send.focus();
      }
    });
    edit.addEventListener('click', () => {
      for (const child of form.children) child.hidden = child === preview;
      form.elements.name.focus();
    });
  }
})();
