// Rapiz Agents on the home page (markup: tools/templates/rapiz-agents.html).
// Part 1 plays one illustrated story across two chats; part 2 steps through one run of the chosen agent.
(() => {
  const root = document.getElementById('agents');
  if (!root) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const motion = () => !reduced.matches;
  root.classList.add('ag-js');

  // ---------- Part 1: the two chats ----------
  const duo = document.getElementById('ag-duo');
  const items = [...duo.querySelectorAll('[data-at]')];
  const last = Math.max(...items.map((i) => +i.dataset.at));
  const approve = duo.querySelector('.ag-approve');
  const STORY_HOLD = 1150;
  let story = last;
  let storyTimer = 0;

  function renderStory() {
    items.forEach((i) => i.classList.toggle('ag-on', +i.dataset.at <= story));
    approve.classList.toggle('ag-done', story >= 7);
    duo.classList.toggle('ag-linked', story >= 8);
    duo.classList.toggle('ag-fixed', story >= 9);
  }
  function storyTick() {
    if (story >= last) return;
    story++;
    renderStory();
    storyTimer = setTimeout(storyTick, story === 6 ? STORY_HOLD * 1.6 : STORY_HOLD);
  }
  function playStory() {
    if (!motion()) return;
    clearTimeout(storyTimer);
    story = 0;
    duo.classList.add('ag-playing');
    renderStory();
    storyTimer = setTimeout(storyTick, 300);
  }
  renderStory();
  document.getElementById('ag-duo-replay').addEventListener('click', playStory);
  if (motion()) {
    let seen = false;
    new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !seen) {
          seen = true;
          playStory();
        }
      },
      { threshold: 0.3 },
    ).observe(duo);
  }

  // ---------- Part 2: one run of the chosen agent ----------
  const stage = root.querySelector('.ag-stage');
  const status = root.querySelector('[data-status]');
  const toggle = root.querySelector('[data-act="toggle"]');
  const HOLD = 1250;
  const NEXT_SCN = 2600;
  const st = { agent: 'shop', scn: 0, step: 0, playing: false, timer: 0, chain: true, seen: false, inView: false, autoPaused: false };

  const run = () => root.querySelector(`.ag-run[data-agent="${st.agent}"][data-scn="${st.scn}"]`);
  const lastScn = () => root.querySelectorAll(`.ag-run[data-agent="${st.agent}"]`).length - 1;
  const fig = () => root.querySelector(st.agent === 'shop' ? '.ag-fig-shop' : '.ag-fig-pa');

  function render() {
    root.dataset.agent = st.agent;
    root.dataset.scn = String(st.scn);
    const rows = [...run().children];
    const f = fig();
    root.querySelector('#ag-run-title').textContent = run().dataset.title;
    root.querySelectorAll('.ag-tabs [data-pick]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.pick === st.agent)));
    root.querySelectorAll(`.ag-scn.ag-for-${st.agent} [data-scn]`).forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.scn === st.scn)));
    f.querySelectorAll('.ag-nd').forEach((n) => n.classList.remove('ag-is-active', 'ag-is-done'));
    f.querySelectorAll('.ag-pill').forEach((p) => p.classList.remove('ag-is-on'));
    f.querySelectorAll('.ag-flow').forEach((p) => p.classList.remove('ag-on'));
    // Each step lights its node in both the desktop diagram and the phone list.
    const nodes = (name) => f.querySelectorAll(`.ag-nd[data-node="${name}"]`);
    rows.forEach((li, i) => {
      const n = i + 1;
      li.classList.toggle('ag-is-visible', n <= st.step);
      li.classList.toggle('ag-is-current', n === st.step);
      if (n < st.step) nodes(li.dataset.node).forEach((el) => el.classList.add('ag-is-done'));
    });
    const cur = rows[st.step - 1];
    if (cur) {
      nodes(cur.dataset.node).forEach((el) => el.classList.add('ag-is-active'));
      f.querySelectorAll(`.ag-flow[data-into="${cur.dataset.node}"]`).forEach((p) => p.classList.add('ag-on'));
      if (cur.dataset.sub) f.querySelector(`.ag-pill[data-sub="${cur.dataset.sub}"]`)?.classList.add('ag-is-on');
    }
    root.querySelector('[data-act="prev"]').disabled = st.step <= 0;
    root.querySelector('[data-act="next"]').disabled = st.step >= rows.length;
    toggle.setAttribute('aria-pressed', String(st.playing));
    toggle.querySelector('[data-toggle-label]').textContent = st.playing ? 'Tạm dừng' : 'Chạy';
  }

  function stop() {
    clearTimeout(st.timer);
    st.playing = false;
    render();
  }
  function tick() {
    if (st.step < run().children.length) {
      st.step++;
      render();
      st.timer = setTimeout(tick, HOLD);
    } else if (st.chain && st.scn < lastScn()) {
      st.timer = setTimeout(() => {
        st.scn++;
        st.step = 0;
        render();
        tick();
      }, NEXT_SCN);
    } else {
      st.playing = false;
      render();
    }
  }
  function play() {
    if (!motion()) return;
    clearTimeout(st.timer);
    if (st.step >= run().children.length) st.step = 0;
    st.playing = true;
    render();
    st.timer = setTimeout(tick, 400);
  }
  function select(agent, scn) {
    clearTimeout(st.timer);
    st.agent = agent;
    st.scn = scn;
    st.step = motion() ? 0 : run().children.length;
    st.playing = false;
    render();
    status.textContent = `${agent === 'shop' ? 'Shop-Agent' : 'Personal-Assistant'}: ${run().dataset.title}`;
    if (motion() && st.inView) play();
  }
  function stepTo(step) {
    clearTimeout(st.timer);
    st.playing = false;
    st.step = Math.max(0, Math.min(run().children.length, step));
    render();
  }

  root.querySelectorAll('[data-pick]').forEach((b) =>
    b.addEventListener('click', () => {
      st.chain = true;
      if (b.classList.contains('ag-go')) {
        st.inView = true;
        document.getElementById('core-ai').scrollIntoView({ behavior: motion() ? 'smooth' : 'auto' });
      }
      select(b.dataset.pick, 0);
    }),
  );
  root.querySelectorAll('.ag-scn [data-scn]').forEach((b) =>
    b.addEventListener('click', () => {
      st.chain = false;
      select(st.agent, +b.dataset.scn);
    }),
  );
  root.querySelector('.ag-ctrl').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    st.autoPaused = false;
    st.chain = false;
    if (act === 'toggle') {
      if (st.playing) stop();
      else play();
    }
    if (act === 'replay') {
      st.step = 0;
      play();
    }
    if (act === 'prev') stepTo(st.step - 1);
    if (act === 'next') stepTo(st.step + 1);
    status.textContent = `Bước ${st.step} / ${run().children.length}`;
  });
  stage.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') stepTo(st.step + 1);
    else if (e.key === 'ArrowLeft') stepTo(st.step - 1);
    else return;
    e.preventDefault();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && st.playing) stop();
  });

  if (motion()) {
    root.classList.add('ag-motion');
    render();
    new IntersectionObserver(
      ([e]) => {
        st.inView = e.isIntersecting;
        if (e.isIntersecting && (!st.seen || st.autoPaused)) {
          st.seen = true;
          st.autoPaused = false;
          play();
        } else if (!e.isIntersecting && st.playing) {
          stop();
          st.autoPaused = true;
        }
      },
      { threshold: 0.35 },
    ).observe(stage);
  } else {
    st.step = run().children.length;
    render();
    status.textContent = 'Đang tắt chuyển động: hiện đầy đủ lượt chạy.';
  }
})();
