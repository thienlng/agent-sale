(() => {
  const panel = document.querySelector('[data-ra-console]');
  const prompts = panel.querySelectorAll('[data-ra-prompt]');
  const days = panel.querySelectorAll('.ra-day');
  const reports = {
    orders: {
      question: 'Tuần này có bao nhiêu đơn?',
      unit: 'đơn hàng trong tuần',
      label: 'Đơn hàng',
      counts: [4, 9, 8, 12, 10, 14, 15]
    },
    conversations: {
      question: 'Tuần này có bao nhiêu hội thoại?',
      unit: 'hội thoại trong tuần',
      label: 'Hội thoại',
      counts: [26, 44, 37, 52, 41, 55, 53]
    }
  };
  function explainPolicy() {
    const limit = document.querySelector('[name="exchange-window"]:checked').value;
    panel.querySelector('[data-ra-reason]').textContent = limit === '7'
      ? 'Shop cho đổi size trong 7 ngày. Khách đã nhận áo 10 ngày, quá hạn 3 ngày nên Rapiz đề nghị nhờ nhân viên kiểm tra thêm.'
      : 'Shop cho đổi size trong 14 ngày. Áo còn nguyên tem và khách mới nhận được 10 ngày, nên Rapiz hỏi mã đơn để kiểm tra size L.';
  }
  function showReport(report) {
    panel.querySelector('[data-ra-question]').textContent = report.question;
    panel.querySelector('[data-ra-total]').textContent = report.counts.reduce((sum, count) => sum + count, 0);
    panel.querySelector('[data-ra-unit]').textContent = report.unit;
    const maxCount = Math.max(...report.counts);
    days.forEach((day, index) => {
      day.style.setProperty('--bar', (report.counts[index] / maxCount * 86) + '%');
      day.querySelector('span').textContent = report.counts[index];
    });
    panel.querySelector('[data-ra-plot]').setAttribute('aria-label', report.label + ' từ thứ hai đến chủ nhật: ' + report.counts.join(', ') + '.');
  }
  for (const button of prompts) {
    button.addEventListener('click', () => {
      const key = button.dataset.raPrompt;
      const isDiagnosis = key === 'diagnosis';
      panel.querySelector('[data-ra-metrics]').hidden = isDiagnosis;
      panel.querySelector('[data-ra-explanation]').hidden = !isDiagnosis;
      if (isDiagnosis) {
        panel.querySelector('[data-ra-question]').textContent = 'Vì sao Rapiz trả lời khách như vậy về việc đổi size?';
        explainPolicy();
      } else {
        showReport(reports[key]);
      }
      prompts.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
    });
  }
  document.querySelector('.policy-options').addEventListener('change', explainPolicy);
})();
