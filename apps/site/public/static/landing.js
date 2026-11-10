// Each industry follows one thread: what the customer needs → what Rapiz checks → what the business gets.
// The card moves through checking → draft → done; the draft is only a proposal until the customer sends what is missing.
const scenes = {
  retail: {
    tasks: [['Tra giá và tồn kho trước khi trả lời', 'tinh-nang/ban-hang-ai/'], ['Trả lời bình luận dưới bài đăng', 'tinh-nang/binh-luan-facebook/'], ['Đồng bộ sản phẩm từ KiotViet', 'tich-hop/']],
    page: 'nganh/ban-le/',
    label: 'Bán lẻ & thương mại điện tử',
    title: 'Khách hỏi size. Rapiz kiểm tra ngay.',
    question: 'Áo sơ mi trắng còn size M không shop?',
    checking: 'Đang kiểm tra tồn kho',
    lookup: 'Đã kiểm tra tồn kho',
    reply: 'Dạ còn size M ạ, giá 350.000đ/áo. Bạn muốn mình lên đơn giúp không?',
    document: 'Đơn hàng dự kiến',
    facts: [['Sản phẩm', 'Áo sơ mi trắng · M'], ['Tạm tính', '350.000đ']],
    action: 'Tiếp tục đặt hàng',
    follow: 'Lên đơn giúp mình nhé, giao về Quận 7.',
    extra: ['Giao đến', 'Quận 7, TP.HCM'],
    doneDocument: 'Đơn hàng',
    result: 'Khách đã xác nhận và gửi địa chỉ. Đơn được tạo trong Rapiz, chờ nhân viên duyệt.'
  },
  villa: {
    tasks: [['Lịch trống và giá theo từng căn', 'tinh-nang/khach-hang-thong-ke/'], ['Giữ chỗ tạm, tự hết hạn', 'tinh-nang/ban-hang-ai/'], ['Nhân viên chốt lịch với khách', 'tinh-nang/hop-thu/']],
    page: 'nganh/villa-homestay/',
    label: 'Lưu trú & nghỉ dưỡng',
    title: 'Hỏi phòng cuối tuần. Rapiz xem lịch trống.',
    question: 'Cuối tuần này còn căn nào cho nhóm 8 người không ạ?',
    checking: 'Đang xem lịch phòng',
    lookup: 'Đã xem lịch trống và giá',
    reply: 'Dạ tối thứ Bảy còn căn 4 phòng ngủ, ở thoải mái 8 người, giá 4.800.000đ/đêm. Bạn muốn mình giữ chỗ tạm để nhân viên gọi xác nhận không?',
    document: 'Yêu cầu giữ chỗ',
    facts: [['Căn', '4 phòng ngủ · 8 khách'], ['Tạm tính', '4.800.000đ/đêm']],
    action: 'Giữ chỗ tạm',
    follow: 'Giữ giúp mình nhé, mình tên Khánh, số 0901 234 567.',
    extra: ['Liên hệ', 'Khánh · 0901 234 567'],
    doneDocument: 'Giữ chỗ tạm',
    result: 'Căn được giữ tạm có thời hạn. Nhân viên gọi khách xác nhận trước khi chốt lịch phòng.'
  },
  spa: {
    tasks: [['Ghi yêu cầu lịch hẹn đủ thông tin', 'tinh-nang/ban-hang-ai/'], ['Trạng thái khách theo quy trình spa', 'tinh-nang/khach-hang-thong-ke/'], ['Báo cáo lịch hẹn mỗi sáng', 'tinh-nang/tro-ly-rapiz/']],
    page: 'nganh/spa-salon/',
    label: 'Làm đẹp & spa',
    title: 'Hẹn qua tin nhắn. Rapiz tìm giờ trống.',
    question: 'Mai 15h còn chỗ chăm sóc da ở Quận 3 không bạn?',
    checking: 'Đang xem lịch chi nhánh',
    lookup: 'Đã xem dịch vụ và lịch chi nhánh Quận 3',
    reply: 'Dạ 15h mai chi nhánh Quận 3 còn trống ạ. Liệu trình chăm sóc da cơ bản khoảng 60 phút. Mình ghi lịch cho bạn nhé?',
    document: 'Lịch hẹn dự kiến',
    facts: [['Dịch vụ', 'Chăm sóc da · 60 phút'], ['Thời gian', '15:00 mai · Quận 3']],
    action: 'Ghi lịch hẹn',
    follow: 'Ok bạn, mình tên Thu, số 0938 456 789.',
    extra: ['Khách', 'Hà Thu · 0938 456 789'],
    doneDocument: 'Lịch hẹn',
    result: 'Lịch hẹn đã được ghi. Chi nhánh Quận 3 xem lịch trong Rapiz và xác nhận lại với khách.'
  },
  education: {
    tasks: [['Ghi danh test và học thử', 'tinh-nang/ban-hang-ai/'], ['Trạng thái tuyển sinh', 'tinh-nang/khach-hang-thong-ke/'], ['Chuyển tư vấn viên kèm tóm tắt', 'tinh-nang/hop-thu/']],
    page: 'nganh/giao-duc/',
    label: 'Giáo dục & đào tạo',
    title: 'Phụ huynh hỏi lớp. Rapiz tìm lớp phù hợp.',
    question: 'Con mình học lớp 8, thứ Bảy học thử tiếng Anh giao tiếp được không ạ?',
    checking: 'Đang tra lịch lớp',
    lookup: 'Đã tra chương trình và lịch học thử',
    reply: 'Dạ được ạ. Sáng thứ Bảy có lớp giao tiếp cho học sinh THCS, con học thử được một buổi. Mình ghi tên con để tư vấn viên xếp lớp nhé?',
    document: 'Đăng ký học thử',
    facts: [['Chương trình', 'Giao tiếp · THCS'], ['Buổi học thử', 'Sáng thứ Bảy']],
    action: 'Đăng ký học thử',
    follow: 'Em ghi giúp chị, bé tên An nhé.',
    extra: ['Học viên', 'An · lớp 8'],
    doneDocument: 'Đăng ký học thử',
    result: 'Đã ghi nhận đăng ký. Tư vấn viên gọi phụ huynh để chốt giờ học thử.'
  },
  software: {
    tasks: [['Nhận yêu cầu demo', 'tinh-nang/ban-hang-ai/'], ['Bot gọi API tra tài khoản khách', 'tich-hop/'], ['Theo dõi gói SaaS của khách', 'tinh-nang/khach-hang-thong-ke/']],
    page: 'nganh/phan-mem/',
    label: 'Công nghệ & phần mềm',
    title: 'Khách hỏi demo. Rapiz hỏi rõ nhu cầu.',
    question: 'Đội mình 6 sale, đang tìm phần mềm quản lý khách hàng. Bên bạn demo được không?',
    checking: 'Đang tra thông tin sản phẩm',
    lookup: 'Đã tra tính năng phù hợp cho đội 6 người',
    reply: 'Dạ được ạ. Với đội 6 người, bên mình có thể demo phần quản lý khách và chia khách cho từng sale. Bạn tiện buổi nào trong tuần để chuyên viên liên hệ?',
    document: 'Yêu cầu demo',
    facts: [['Quy mô', '6 nhân viên sale'], ['Nhu cầu', 'Quản lý khách hàng']],
    action: 'Gửi yêu cầu demo',
    follow: 'Chiều thứ Năm nhé, mình là Tuấn.',
    extra: ['Lịch mong muốn', 'Chiều thứ Năm'],
    doneDocument: 'Yêu cầu demo',
    result: 'Yêu cầu demo đã chuyển cho chuyên viên, kèm quy mô đội và nhu cầu. Chuyên viên liên hệ để chốt lịch.'
  }
};

const actionButton = document.getElementById('demo-action');
const resultMessage = document.getElementById('result');
const choices = document.querySelectorAll('[data-scene]');
const handoffLink = document.getElementById('handoff-link');
const slip = document.querySelector('.ix-slip');
const followLine = document.querySelector('.ix-follow');
const extraFact = document.querySelector('.ix-extra');
const sceneMotion = matchMedia('(prefers-reduced-motion: no-preference)');
const CHECK_MS = 900;
let currentScene = 'retail';
let stageTimer;

const setText = (id, text) => { document.getElementById(id).textContent = text; };
function setStage(stage) {
  slip.dataset.stage = stage;
  const scene = scenes[currentScene];
  setText('lookup', stage === 'checking' ? scene.checking : scene.lookup);
  for (const li of slip.querySelectorAll('.ix-steps li')) {
    const order = ['checking', 'draft', 'done'];
    const at = order.indexOf(li.dataset.step), now = order.indexOf(stage);
    li.classList.toggle('done', at < now || stage === 'done');
    if (at === now) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  }
}
function selectScene(key) {
  clearTimeout(stageTimer);
  currentScene = key;
  const scene = scenes[key];
  for (const button of choices) {
    const selected = button.dataset.scene === key;
    button.setAttribute('aria-pressed', String(selected));
    const image = button.querySelector('img');
    if (selected) image.id = 'scene-img';
    else image.removeAttribute('id');
  }
  setText('ix-document', scene.document);
  scene.facts.forEach(([term, value], i) => {
    setText('ix-term-' + (i + 1), term);
    setText('ix-value-' + (i + 1), value);
  });
  extraFact.hidden = true;
  followLine.hidden = true;
  setText('scene-label', scene.label);
  document.getElementById('ix-tasks').replaceChildren(...scene.tasks.map(([text, href]) => {
    const item = document.createElement('li');
    item.append(Object.assign(document.createElement('a'), { href, textContent: text }));
    return item;
  }));
  const pageLink = document.getElementById('scene-page');
  pageLink.href = scene.page;
  pageLink.querySelector('[data-scene-page-label]').textContent = `Giải pháp cho ${scene.label.toLowerCase()}`;
  setText('scene-title', scene.title);
  setText('question', scene.question);
  setText('reply', scene.reply);
  resultMessage.hidden = true;
  handoffLink.hidden = true;
  resultMessage.textContent = '';
  actionButton.firstChild.textContent = scene.action + ' ';
  // Show the lookup briefly, then the draft. Without motion the draft is there at once.
  if (sceneMotion.matches) {
    setStage('checking');
    stageTimer = setTimeout(() => setStage('draft'), CHECK_MS);
  } else setStage('draft');
}
for (const button of choices) {
  button.addEventListener('click', () => selectScene(button.dataset.scene));
}
// The first time the card comes into view, play the lookup once so the order of work is visible.
if ('IntersectionObserver' in window && sceneMotion.matches) {
  new IntersectionObserver(([entry], io) => {
    if (!entry.isIntersecting) return;
    io.disconnect();
    if (slip.dataset.stage === 'draft') selectScene(currentScene);
  }, { threshold: .6 }).observe(slip);
}
actionButton.addEventListener('click', () => {
  if (slip.dataset.stage === 'done') {
    selectScene(currentScene);
    return;
  }
  clearTimeout(stageTimer);
  const scene = scenes[currentScene];
  setText('follow', scene.follow);
  followLine.hidden = false;
  setText('ix-term-3', scene.extra[0]);
  setText('ix-value-3', scene.extra[1]);
  extraFact.hidden = false;
  setText('ix-document', scene.doneDocument);
  setStage('done');
  resultMessage.textContent = scene.result;
  resultMessage.hidden = false;
  handoffLink.hidden = currentScene !== 'retail';
  actionButton.firstChild.textContent = 'Xem lại từ đầu ';
});



const policyAnswers = {
  '7': 'Dạ, shop hỗ trợ đổi size trong 7 ngày kể từ khi nhận áo. Đơn của bạn đã qua thời hạn. Bạn muốn mình nhờ nhân viên kiểm tra thêm không?',
  '14': 'Dạ được ạ. Shop hỗ trợ đổi size trong 14 ngày kể từ khi nhận áo. Áo còn nguyên tem và bạn còn 4 ngày để yêu cầu đổi. Bạn cho mình xin mã đơn để kiểm tra size L nhé!'
};
document.querySelector('.policy-options')?.addEventListener('change', event => {
  const days = event.target.value;
  document.getElementById('policy-number').textContent = days.padStart(2, '0');
  document.getElementById('policy-response').textContent = policyAnswers[days];
});

// Each destination is still an ordinary fragment link. Opening a nested tour
// screenshot from the training demo also reveals the product chapter it lives in.
const lab = document.getElementById('product-lab');
const chapterLinks = lab ? Array.from(lab.querySelectorAll('.lab-choices a')) : [];
const chapters = chapterLinks.map(link => document.getElementById(link.hash.slice(1)));

function showProductChapter(scroll) {
  const target = document.getElementById(location.hash.slice(1));
  const selected = chapters.find(chapter => target && chapter.contains(target));
  if (!selected && scroll) return;
  const active = selected || chapters[0];
  if (!active) return;
  chapters.forEach((chapter, index) => {
    chapter.hidden = chapter !== active;
    if (chapter === active) chapterLinks[index].setAttribute('aria-current', 'location');
    else chapterLinks[index].removeAttribute('aria-current');
  });
  if (scroll && selected) {
    requestAnimationFrame(() => (target === selected ? lab : target).scrollIntoView({block:'start'}));
  }
}
showProductChapter(false);
window.addEventListener('hashchange', () => showProductChapter(true));

const messageHero = document.querySelector('.message-hero');
const replies = {
  retail: {
    working: 'Đang tra tồn kho',
    status: 'Đã tra tồn kho',
    reply: 'Dạ còn size M, giá 350.000đ một áo. Bạn muốn mình lên đơn một chiếc không?',
    link: 'Thử xác nhận đơn',
    scene: 'retail'
  },
  villa: {
    working: 'Đang tra lịch phòng',
    status: 'Đã tra lịch phòng',
    reply: 'Tối thứ Bảy còn căn 4 phòng ngủ cho 8 khách, giá 4.800.000đ một đêm. Mình gửi yêu cầu giữ chỗ nhé?',
    link: 'Thử giữ chỗ',
    scene: 'villa'
  },
  spa: {
    working: 'Đang tra dịch vụ',
    status: 'Đã tra dịch vụ',
    reply: 'Dạ, mình ghi nhận yêu cầu chăm sóc da lúc 15h ngày mai ở Quận 3 để nhân viên xác nhận với bạn nhé?',
    link: 'Thử gửi yêu cầu hẹn',
    scene: 'spa'
  },
  education: {
    working: 'Đang tra lịch học',
    status: 'Đã tra lịch học',
    reply: 'Dạ có lớp Giao tiếp THCS vào sáng thứ Bảy. Mình đăng ký cho con một buổi học thử nhé?',
    link: 'Thử đăng ký học thử',
    scene: 'education'
  }
};

const messageChoices = [...messageHero.querySelectorAll('[data-message]')];
const messageKeys = messageChoices.map(choice => choice.dataset.message);
const messageLink = document.getElementById('pulse-next');
const answerBox = messageHero.querySelector('.pulse-answer');
const motionAllowed = matchMedia('(prefers-reduced-motion: no-preference)');

// Hidden copies of every reply share the visible reply's grid cell, so the card never changes height.
const sizer = document.createElement('span');
sizer.className = 'pulse-sizer';
sizer.setAttribute('aria-hidden', 'true');
for (const key of messageKeys) sizer.append(Object.assign(document.createElement('span'), { textContent: replies[key].reply }));
answerBox.querySelector('.pulse-reply').append(sizer);

// One scenario: the note lights up, Rapiz looks things up, then the reply appears.
const LOOKUP_MS = 1500;   // lookup in progress
const READ_MS = 3600;     // reply on screen before the next message
const RESUME_MS = 1200;   // quiet time after hover or focus leaves
const IDLE_MS = 6000;     // after a click, reply on screen this long before the loop picks up again

let revealTimer;
function openMessage(key) {
  const data = replies[key];
  clearTimeout(revealTimer);
  messageHero.dataset.active = key;
  for (const choice of messageChoices) choice.setAttribute('aria-pressed', String(choice.dataset.message === key));
  const channel = messageHero.querySelector(`[data-message="${key}"] .note-meta small`)?.textContent;
  for (const tab of messageHero.querySelectorAll('.pulse-tabs [data-channel]')) tab.classList.toggle('on', tab.dataset.channel === channel);
  messageLink.firstChild.textContent = data.link + ' ';
  messageLink.setAttribute('href', data.scene ? '#solutions' : 'tinh-nang/hop-thu/#handoff');
  if (!motionAllowed.matches) {
    showReply(key);
    return;
  }
  const wire = messageHero.querySelector('.wire-' + key);
  const trip = messageHero.querySelector('#packet-trip');
  trip.querySelector('mpath').setAttribute('href', '#' + wire.id);
  messageHero.querySelector('#packet-visible').beginElement?.();
  trip.beginElement?.();
  wire.animate([{ strokeDashoffset: 70 }, { strokeDashoffset: 0 }], { duration: 520, easing: 'ease-out' });
  answerBox.dataset.state = 'working';
  document.getElementById('pulse-status').textContent = data.working;
  revealTimer = setTimeout(() => showReply(key), LOOKUP_MS);
}
function showReply(key) {
  clearTimeout(revealTimer);
  document.getElementById('pulse-status').textContent = replies[key].status;
  document.getElementById('pulse-answer').textContent = replies[key].reply;
  answerBox.dataset.state = 'done';
}

// The loop runs on one timer. Pausing keeps the time that was left, so resuming continues the same wait.
let loopTimer = null, due = 0, pending = null, left = 0;
const holds = new Set();
function later(fn, ms) {
  clearTimeout(loopTimer);
  loopTimer = null; pending = fn; left = ms; due = performance.now() + ms;
  if (!holds.size) loopTimer = setTimeout(() => { loopTimer = null; pending = null; fn(); }, ms);
}
function hold(reason) {
  if (holds.has(reason)) return;
  holds.add(reason);
  if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; left = Math.max(0, due - performance.now()); }
}
function release(reason, delay = 0) {
  if (!holds.delete(reason) || holds.size || !pending) return;
  later(pending, Math.max(left, delay));
}
function runFrom(index) {
  openMessage(messageKeys[index % messageKeys.length]);
  later(() => runFrom(index + 1), LOOKUP_MS + READ_MS);
}
function startAutoplay(index, delay) {
  if (!motionAllowed.matches) return;
  answerBox.setAttribute('aria-live', 'off'); // the loop should not talk over a screen reader every few seconds
  later(() => runFrom(index), delay);
}
function stopAutoplay() {
  clearTimeout(loopTimer);
  loopTimer = null; pending = null;
  answerBox.setAttribute('aria-live', 'polite');
}

for (const choice of messageChoices) choice.addEventListener('click', () => {
  stopAutoplay();
  openMessage(choice.dataset.message);
  startAutoplay(messageKeys.indexOf(choice.dataset.message) + 1, LOOKUP_MS + IDLE_MS);
  answerBox.setAttribute('aria-live', 'polite');
});

// Pause while the visitor points at (mouse) or tabs through (keyboard focus) the notes and the reply card, offscreen, or in a background tab.
for (const zone of [messageHero.querySelector('.pulse-sources'), messageHero.querySelector('.pulse-output')]) {
  zone.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') hold('hover'); });
  zone.addEventListener('pointerleave', () => release('hover', RESUME_MS));
  zone.addEventListener('focusin', e => { if (e.target.matches(':focus-visible')) hold('focus'); });
  zone.addEventListener('focusout', e => { if (!zone.contains(e.relatedTarget)) release('focus', RESUME_MS); });
}
document.addEventListener('visibilitychange', () => (document.hidden ? hold('tab') : release('tab', 600)));
if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => (entry.isIntersecting ? release('offscreen', 600) : hold('offscreen')))
    .observe(messageHero);
}
motionAllowed.addEventListener('change', () => {
  if (motionAllowed.matches) startAutoplay(messageKeys.indexOf(messageHero.dataset.active) + 1, READ_MS);
  else { stopAutoplay(); openMessage(messageHero.dataset.active); }
});
startAutoplay(1, READ_MS);

messageLink.addEventListener('click', () => {
  stopAutoplay();
  const scene = replies[messageHero.dataset.active].scene;
  if (scene) selectScene(scene);
});

// The secondary CTA waits for the Agent Harness section; until that ships the link stays hidden.
const explore = messageHero.querySelector('.pulse-explore');
const harness = document.getElementById(explore.dataset.section);
if (harness && !harness.hidden) {
  explore.href = '#' + harness.id;
  explore.hidden = false;
}

