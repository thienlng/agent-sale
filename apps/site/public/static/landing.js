const scenes = {
  retail: {
    page: 'nganh/ban-le/',
    image: 'images/rapiz-retail.webp',
    label: 'Bán lẻ online',
    title: 'Từ câu hỏi size đến đơn hàng.',
    question: 'Áo sơ mi trắng còn size M không shop?',
    lookup: 'Đã tra danh mục và tồn kho',
    reply: 'Dạ còn size M. Một áo giá 350.000đ. Bạn xác nhận đặt một chiếc nhé?',
    action: 'Xác nhận đặt hàng',
    result: 'Đã ghi nhận đơn 1 áo sơ mi trắng, size M. Nhân viên có thể xem và duyệt đơn trong Rapiz.'
  },
  villa: {
    page: 'nganh/villa-homestay/',
    image: 'images/photo-m61856012-960.jpg',
    label: 'Villa & homestay',
    title: 'Từ hỏi ngày trống đến giữ chỗ.',
    question: 'Cuối tuần này còn căn 4 phòng ngủ cho 8 người không?',
    lookup: 'Đã tra lịch trống và giá theo gói',
    reply: 'Dạ còn căn 4 phòng ngủ cho tối thứ Bảy, giá 4.800.000đ một đêm. Bạn muốn giữ chỗ để nhân viên liên hệ xác nhận không?',
    action: 'Yêu cầu giữ chỗ',
    result: 'Đã ghi nhận lượt giữ chỗ có thời hạn. Nhân viên sẽ liên hệ xác nhận trước khi chốt lịch phòng.'
  },
  spa: {
    page: 'nganh/spa-salon/',
    image: 'images/rapiz-spa.webp',
    label: 'Spa & salon',
    title: 'Từ hỏi dịch vụ đến hẹn lịch.',
    question: 'Mình muốn đặt lịch chăm sóc da lúc 15h ngày mai ở quận 3.',
    lookup: 'Đã tra dịch vụ và chi nhánh',
    reply: 'Mình ghi nhận yêu cầu chăm sóc da cho một người tại chi nhánh Quận 3, lúc 15h ngày mai nhé?',
    action: 'Gửi yêu cầu hẹn',
    result: 'Đã ghi nhận yêu cầu hẹn. Nhân viên chi nhánh Quận 3 sẽ liên hệ để xác nhận lịch với bạn.'
  },
  education: {
    page: 'nganh/giao-duc/',
    image: 'images/rapiz-education.webp',
    label: 'Trung tâm giáo dục',
    title: 'Từ hỏi lớp đến đăng ký học thử.',
    question: 'Con mình học lớp 8, muốn học thử tiếng Anh giao tiếp vào thứ Bảy.',
    lookup: 'Đã tra chương trình học thử',
    reply: 'Dạ, trung tâm có lớp giao tiếp cho học sinh THCS. Mình ghi nhận nguyện vọng học thử vào thứ Bảy để tư vấn viên liên hệ xếp lớp cho con nhé?',
    action: 'Đăng ký học thử',
    result: 'Đã ghi nhận yêu cầu học thử cho học sinh lớp 8. Tư vấn viên sẽ liên hệ phụ huynh để xác nhận ca học.'
  },
  software: {
    page: 'nganh/phan-mem/',
    image: 'images/rapiz-software.webp',
    label: 'Doanh nghiệp phần mềm',
    title: 'Từ nhu cầu đến buổi demo.',
    question: 'Đội mình có 6 sale, muốn xem demo phần mềm quản lý khách hàng.',
    lookup: 'Đã tra thông tin sản phẩm',
    reply: 'Dạ, mình ghi nhận nhu cầu quản lý khách hàng cho đội 6 người. Bạn muốn chuyên viên liên hệ hẹn buổi demo theo quy trình bán hàng của đội mình không?',
    action: 'Yêu cầu demo',
    result: 'Đã ghi nhận yêu cầu demo cùng quy mô đội sale và nhu cầu sử dụng. Chuyên viên sẽ liên hệ để thống nhất lịch.'
  }
};

const scenario = document.getElementById('scenario');
const actionButton = document.getElementById('demo-action');
const resultMessage = document.getElementById('result');
const choices = document.querySelectorAll('[data-scene]');
const handoffLink = document.getElementById('handoff-link');
let currentScene = 'retail';

function selectScene(key) {
  currentScene = key;
  const scene = scenes[key];
  for (const button of choices) {
    button.setAttribute('aria-pressed', String(button.dataset.scene === key));
  }
  document.getElementById('scene-img').src = scene.image;
  document.getElementById('scene-label').textContent = scene.label;
  const pageLink = document.getElementById('scene-page');
  pageLink.href = scene.page;
  pageLink.querySelector('[data-scene-page-label]').textContent = `Giải pháp cho ${scene.label.toLowerCase()}`;
  document.getElementById('scene-title').textContent = scene.title;
  for (const field of ['question', 'lookup', 'reply']) {
    document.getElementById(field).textContent = scene[field];
  }
  resultMessage.hidden = true;
  handoffLink.hidden = true;
  resultMessage.textContent = '';
  actionButton.firstChild.textContent = scene.action + ' ';
  scenario.classList.remove('swapping');
  requestAnimationFrame(() => requestAnimationFrame(() => scenario.classList.add('swapping')));
}
for (const button of choices) {
  button.addEventListener('click', () => selectScene(button.dataset.scene));
}
actionButton.addEventListener('click', () => {
  if (!resultMessage.hidden) {
    selectScene(currentScene);
    return;
  }
  resultMessage.textContent = scenes[currentScene].result;
  resultMessage.hidden = false;
  handoffLink.hidden = currentScene !== 'retail';
  actionButton.firstChild.textContent = 'Thử lại ';
});
document.querySelector('.hero-receipt').addEventListener('click', () => selectScene('retail'));


const policyAnswers = {
  '7': 'Dạ, shop hỗ trợ đổi size trong 7 ngày kể từ khi nhận áo. Đơn của bạn đã qua thời hạn. Bạn muốn mình nhờ nhân viên kiểm tra thêm không?',
  '14': 'Dạ được ạ. Shop hỗ trợ đổi size trong 14 ngày kể từ khi nhận áo. Áo còn nguyên tem và bạn còn 4 ngày để yêu cầu đổi. Bạn cho mình xin mã đơn để kiểm tra size L nhé!'
};
document.querySelector('.policy-options').addEventListener('change', event => {
  const days = event.target.value;
  document.getElementById('policy-number').textContent = days.padStart(2, '0');
  document.getElementById('policy-response').textContent = policyAnswers[days];
});

// Each destination is still an ordinary fragment link. Opening a nested tour
// screenshot from the training demo also reveals the product chapter it lives in.
const lab = document.getElementById('product-lab');
const chapterLinks = Array.from(lab.querySelectorAll('.lab-choices a'));
const chapters = chapterLinks.map(link => document.getElementById(link.hash.slice(1)));

function showProductChapter(scroll) {
  const target = document.getElementById(location.hash.slice(1));
  const selected = chapters.find(chapter => target && chapter.contains(target));
  if (!selected && scroll) return;
  const active = selected || chapters[0];
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
