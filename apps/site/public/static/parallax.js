// Hero mouse parallax: each artwork layer drifts by its own depth (data-depth = max px).
// Desktop pointers only; touch and reduced motion keep the picture still.
(() => {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  const layers = [...hero.querySelectorAll('.hero-layer')]
    .map(el => ({ el, depth: Number(el.dataset.depth) || 0 }))
    .filter(l => l.depth > 0);
  if (!layers.length) return;

  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const TAU = 0.26; // seconds; ~0.7s to settle
  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };
  let raf = 0, last = 0, inView = true;

  const enabled = () => finePointer.matches && !reducedMotion.matches;

  function apply() {
    for (const { el, depth } of layers) {
      el.style.transform = `translate3d(${(-current.x * depth).toFixed(2)}px, ${(-current.y * depth).toFixed(2)}px, 0)`;
    }
  }

  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    const k = 1 - Math.exp(-dt / TAU);
    current.x += (target.x - current.x) * k;
    current.y += (target.y - current.y) * k;
    apply();
    const settled = Math.abs(target.x - current.x) < 0.001 && Math.abs(target.y - current.y) < 0.001;
    if (settled || !inView) { raf = 0; last = 0; return; }
    raf = requestAnimationFrame(frame);
  }
  const wake = () => { if (!raf && inView) raf = requestAnimationFrame(frame); };

  function onMove(e) {
    if (!enabled()) return;
    const r = hero.getBoundingClientRect();
    target.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    target.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    wake();
  }
  function onLeave() { target.x = 0; target.y = 0; wake(); }
  function reset() {
    target.x = target.y = current.x = current.y = 0;
    for (const { el } of layers) el.style.transform = '';
  }

  hero.addEventListener('pointermove', onMove, { passive: true });
  hero.addEventListener('pointerleave', onLeave, { passive: true });
  const onPrefChange = () => { if (!enabled()) reset(); };
  finePointer.addEventListener('change', onPrefChange);
  reducedMotion.addEventListener('change', onPrefChange);

  const io = new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    if (inView) wake();
  });
  io.observe(hero);

  // cleanup hook for when the hero is removed (e.g. when ported into a component)
  hero.destroyParallax = () => {
    cancelAnimationFrame(raf);
    hero.removeEventListener('pointermove', onMove);
    hero.removeEventListener('pointerleave', onLeave);
    finePointer.removeEventListener('change', onPrefChange);
    reducedMotion.removeEventListener('change', onPrefChange);
    io.disconnect();
    reset();
  };
})();
