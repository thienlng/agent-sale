(() => {
  const panel = document.querySelector('[data-handoff]');
  if (!panel) return;
  const take = panel.querySelector('[data-rh-take]');
  const reset = panel.querySelector('[data-rh-reset]');
  const form = panel.querySelector('[data-rh-form]');
  const draft = form.elements.message;
  const staffMessage = panel.querySelector('[data-rh-staff]');
  const sent = panel.querySelector('[data-rh-sent]');
  const status = panel.querySelector('[data-rh-status]');
  const announcement = panel.querySelector('[data-rh-announce]');
  const suggestedReply = 'Chào chị Linh, em đang kiểm tra đơn áo sơ mi. Chị cho em xin địa chỉ mới để em đối chiếu nhé.';

  take.addEventListener('click', () => {
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
    status.textContent = 'Chờ tiếp quản';
    announcement.textContent = 'Đã bắt đầu lại hội thoại minh họa.';
    take.focus();
  });
})();
