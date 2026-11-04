// Timeline control shared by the charts and the live diagram: play / pause,
// step back and forward, jump to the start, and a slider to scrub through quarters.
//
// createTimeline(el, { onChange(q), label(q), texts }) -> { setN, setQuarter, stop, render }

const SPEED_MS = 750;

export function createTimeline(root, { onChange, label, texts }) {
  root.classList.add('timeline');
  let n = 1;
  let q = 0;
  let timer = null;
  let tx = texts();

  root.innerHTML = '';
  const mk = (tag, cls, html) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html !== undefined) node.innerHTML = html;
    return node;
  };
  const btnStart = mk('button', 'btn ghost icon', '⏮');
  const btnBack = mk('button', 'btn ghost icon', '◀');
  const btnPlay = mk('button', 'btn icon play', '▶');
  const btnFwd = mk('button', 'btn ghost icon', '▶|');
  for (const b of [btnStart, btnBack, btnPlay, btnFwd]) b.type = 'button';
  const slider = mk('input');
  slider.type = 'range';
  slider.min = '0';
  slider.step = '1';
  const out = mk('output', 'tl-label');
  const buttons = mk('div', 'tl-buttons');
  buttons.append(btnStart, btnBack, btnPlay, btnFwd);
  root.append(buttons, slider, out);

  function syncTexts() {
    tx = texts();
    btnStart.title = tx.start; btnStart.setAttribute('aria-label', tx.start);
    btnBack.title = tx.back; btnBack.setAttribute('aria-label', tx.back);
    btnFwd.title = tx.forward; btnFwd.setAttribute('aria-label', tx.forward);
    slider.setAttribute('aria-label', tx.slider);
    syncPlay();
  }
  function syncPlay() {
    const playing = timer !== null;
    btnPlay.textContent = playing ? '⏸' : '▶';
    btnPlay.title = playing ? tx.pause : tx.play;
    btnPlay.setAttribute('aria-label', btnPlay.title);
    btnPlay.setAttribute('aria-pressed', String(playing));
  }
  function show() {
    slider.max = String(Math.max(0, n - 1));
    slider.value = String(q);
    out.textContent = label(q);
    btnBack.disabled = q <= 0;
    btnStart.disabled = q <= 0;
    btnFwd.disabled = q >= n - 1;
  }
  function set(next, notify = true) {
    const clamped = Math.max(0, Math.min(n - 1, next));
    const changed = clamped !== q;
    q = clamped;
    show();
    if (notify && changed) onChange(q);
  }
  function stop() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    syncPlay();
  }
  function play() {
    if (q >= n - 1) set(0);
    timer = setInterval(() => {
      if (q >= n - 1) { stop(); return; }
      set(q + 1);
    }, SPEED_MS);
    syncPlay();
  }

  btnPlay.addEventListener('click', () => (timer === null ? play() : stop()));
  btnBack.addEventListener('click', () => { stop(); set(q - 1); });
  btnFwd.addEventListener('click', () => { stop(); set(q + 1); });
  btnStart.addEventListener('click', () => { stop(); set(0); });
  slider.addEventListener('input', () => { stop(); set(Number(slider.value)); });

  syncTexts();
  show();

  return {
    setN(next) { n = Math.max(1, next); if (q > n - 1) set(n - 1); else show(); },
    setQuarter(next) { set(next, false); },
    get quarter() { return q; },
    stop,
    render() { syncTexts(); show(); },
  };
}
