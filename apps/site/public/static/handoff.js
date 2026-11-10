(() => {
  const panel = document.querySelector('[data-handoff]');
  if (!panel) return;
  const take = panel.querySelector('[data-rh-take]');
  take.disabled = false; // ships disabled so the static page does not offer a dead button
  const reset = panel.querySelector('[data-rh-reset]');
  const form = panel.querySelector('[data-rh-form]');
  const draft = form.elements.message;
  const staffMessage = panel.querySelector('[data-rh-staff]');
  const sent = panel.querySelector('[data-rh-sent]');
  const status = panel.querySelector('[data-rh-status]');
  const announcement = panel.querySelector('[data-rh-announce]');
  const suggestedReply = 'Chào anh Đức Anh, em đang kiểm tra lịch căn A17 tối 21/11. Em báo lại anh trong ít phút nhé.';
  const WAITING = 'Chờ nhân viên tiếp quản';

  // Illustrative replay: the customer writes, Rapiz answers and hands over, then the summary appears.
  // It loops while nobody touches the panel; taking over ends the loop. Nothing leaves the page.
  const motion = matchMedia('(prefers-reduced-motion: no-preference)');
  const STEPS = [
    ['customer', 'Khách vừa nhắn', 700],
    ['replying', 'Rapiz đang trả lời', 1300],
    ['agent', 'Rapiz đang chuyển cho nhân viên', 1500],
    ['handoff', WAITING, 7000],
  ];
  let timer = null, step = -1, engaged = false, visible = false, hovered = false;
  const running = () => !engaged && visible && !hovered && motion.matches && !document.hidden;
  const setStage = (stage, label) => { panel.dataset.stage = stage; status.textContent = label; };
  function advance() {
    clearTimeout(timer); timer = null;
    if (!running()) return;
    step = (step + 1) % (STEPS.length + 1);
    if (step === STEPS.length) { setStage('', ''); timer = setTimeout(advance, 600); return; } // fade out, then start over
    const [stage, label, wait] = STEPS[step];
    setStage(stage, label);
    timer = setTimeout(advance, wait);
  }
  function pause() { clearTimeout(timer); timer = null; }
  function resume(delay = 400) { if (running() && !timer) timer = setTimeout(advance, delay); }
  // Pointing at or tabbing into the panel shows the whole handoff at once so it can be read and used.
  function settle() {
    pause();
    if (panel.dataset.stage !== 'handoff') { step = STEPS.length - 1; setStage('handoff', WAITING); }
  }
  function engage() { engaged = true; settle(); }
  function openHandoff() {
    if (['#handoff', '#handoff-desk'].includes(location.hash) && !take.hidden) engage();
  }
  if (motion.matches && 'IntersectionObserver' in window) {
    setStage('', '');
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) resume(step < 0 ? 300 : 900); else pause();
    }, { threshold: .35 }).observe(panel);
    panel.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { hovered = true; settle(); } });
    panel.addEventListener('pointerleave', () => { hovered = false; resume(1200); });
    panel.addEventListener('focusin', e => { if (e.target.matches(':focus-visible')) engage(); });
    document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));
    document.querySelectorAll('a[href="#handoff"], a[href="#handoff-desk"]').forEach(link => {
      link.addEventListener('click', () => { if (!take.hidden) engage(); });
    });
    window.addEventListener('hashchange', openHandoff);
    openHandoff();
  }

  take.addEventListener('click', () => {
    engage();
    take.hidden = true;
    reset.hidden = false;
    form.hidden = false;
    draft.value = suggestedReply;
    status.textContent = 'Bạn đang tiếp quản';
    announcement.textContent = 'Bạn đã tiếp quản hội thoại. Có thể chỉnh sửa và gửi câu trả lời minh họa.';
    draft.focus();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = draft.value.trim();
    if (!message) {
      draft.setCustomValidity('Nhập nội dung trả lời khách.');
      draft.reportValidity();
      return;
    }
    sent.textContent = message;
    staffMessage.hidden = false;
    form.hidden = true;
    status.textContent = 'Nhân viên đã trả lời';
    announcement.textContent = 'Câu trả lời minh họa đã xuất hiện trong hội thoại.';
    reset.focus();
  });
  draft.addEventListener('input', () => draft.setCustomValidity(''));
  reset.addEventListener('click', () => {
    draft.value = '';
    draft.setCustomValidity('');
    sent.textContent = '';
    staffMessage.hidden = true;
    form.hidden = true;
    reset.hidden = true;
    take.hidden = false;
    status.textContent = WAITING;
    announcement.textContent = 'Đã bắt đầu lại hội thoại minh họa.';
    take.focus();
  });
})();
