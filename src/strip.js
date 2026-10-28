// Horizontal card strip: one card visible at a time, CSS scroll-snap for touchpad swipes,
// Shift + wheel steps exactly one card per gesture, dots show the position.

const MAX_DOTS = 12;

export function createStrip(root, dotsRoot, { onIndexChange, onSwitch } = {}) {
  const track = document.createElement('div');
  track.className = 'strip-track';
  root.appendChild(track);

  let index = 0;
  let locked = false;
  let wheelAccum = 0;
  let wheelIdleTimer = null;
  let unlockTimer = null;

  const cards = () => [...track.children];
  const count = () => track.children.length;

  function renderDots() {
    const n = count();
    dotsRoot.innerHTML = '';
    dotsRoot.hidden = n < 2;
    if (n < 2) return;
    if (n > MAX_DOTS) {
      dotsRoot.innerHTML = `<button class="dot-nav" data-step="-1" aria-label="Previous">‹</button>
        <span class="dot-count">${index + 1} / ${n}</span>
        <button class="dot-nav" data-step="1" aria-label="Next">›</button>`;
      return;
    }
    for (let i = 0; i < n; i++) {
      const b = document.createElement('button');
      b.className = 'dot' + (i === index ? ' active' : '');
      b.dataset.index = i;
      b.setAttribute('aria-label', `Card ${i + 1}`);
      dotsRoot.appendChild(b);
    }
  }

  dotsRoot.addEventListener('click', (e) => {
    const dot = e.target.closest('[data-index]');
    if (dot) goTo(Number(dot.dataset.index), true, true);
    const nav = e.target.closest('[data-step]');
    if (nav) goTo(index + Number(nav.dataset.step), true, true);
  });

  /** `user` marks a switch the person made themselves (reported to onSwitch for the stats). */
  function setIndex(i, user = false) {
    if (i === index) return;
    index = i;
    renderDots();
    onIndexChange?.(index);
    if (user) onSwitch?.(index);
  }

  function goTo(i, smooth = true, user = false) {
    const n = count();
    if (!n) return;
    i = Math.max(0, Math.min(n - 1, i));
    const left = i * track.clientWidth;
    track.scrollTo({ left, behavior: smooth ? 'smooth' : 'instant' });
    setIndex(i, user);
  }

  // A scroll only counts as the person switching cards if they just touched the strip
  // (layout changes and window resizes also fire scroll events).
  let lastInput = 0;
  for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown']) {
    track.addEventListener(type, () => (lastInput = Date.now()), { passive: true, capture: true });
  }

  let scrollRaf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = requestAnimationFrame(() => {
      const w = track.clientWidth || 1;
      setIndex(Math.max(0, Math.min(count() - 1, Math.round(track.scrollLeft / w))), Date.now() - lastInput < 1500);
    });
  });

  track.addEventListener('scrollend', () => {
    clearTimeout(unlockTimer);
    unlockTimer = setTimeout(() => (locked = false), 90);
  });

  track.addEventListener(
    'wheel',
    (e) => {
      // Native horizontal (touchpad) scrolling is handled by scroll-snap.
      if (!e.shiftKey || document.body.classList.contains('focusing')) return;
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      wheelAccum += d;
      clearTimeout(wheelIdleTimer);
      wheelIdleTimer = setTimeout(() => (wheelAccum = 0), 180);
      if (locked || Math.abs(wheelAccum) < 24) return;
      const dir = Math.sign(wheelAccum);
      wheelAccum = 0;
      const next = Math.max(0, Math.min(count() - 1, index + dir));
      if (next === index) return;
      locked = true;
      clearTimeout(unlockTimer);
      unlockTimer = setTimeout(() => (locked = false), 450); // fallback if scrollend never fires
      goTo(next, true, true);
    },
    { passive: false },
  );

  // Keep the current card aligned while the window animates between modes.
  new ResizeObserver(() => {
    track.scrollTo({ left: index * track.clientWidth, behavior: 'instant' });
  }).observe(track);

  return {
    track,
    get index() {
      return index;
    },
    cards,
    count,
    indexOf: (card) => cards().indexOf(card.closest('.strip-slot')),
    remove(card) {
      card.closest('.strip-slot')?.remove();
      if (index > count() - 1) index = Math.max(0, count() - 1);
      renderDots();
      goTo(index, false);
    },
    goTo,
    refresh() {
      if (index > count() - 1) index = Math.max(0, count() - 1);
      renderDots();
    },
    /** Append a card (wrapped in a snap slot) and glide to it. */
    append(card, { scroll = true } = {}) {
      const slot = document.createElement('div');
      slot.className = 'strip-slot';
      slot.appendChild(card);
      track.appendChild(slot);
      renderDots();
      if (scroll) requestAnimationFrame(() => goTo(count() - 1));
    },
  };
}
