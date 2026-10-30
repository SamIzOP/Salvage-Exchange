// A non-blocking guide: a spotlight ring on a live control and a step card beside it.
// It never intercepts clicks on the page, so the player always acts on the real controls.
const PHASES = ['lobby', 'briefing', 'planning', 'upgrade', 'finished'];
const stage = (round, phase) => round * 10 + PHASES.indexOf(phase);
const value = (v, c) => typeof v === 'function' ? v(c) : v;
// Height of a bar that stays on screen while the page scrolls (the sticky header, the phone dock).
const pinned = selector => {
  const el = document.querySelector(selector), cs = el && getComputedStyle(el);
  return cs && cs.display !== 'none' && (cs.position === 'fixed' || cs.position === 'sticky') ? el.getBoundingClientRect().height : 0;
};
const visible = el => el && el.getClientRects().length > 0;
const plain = html => { const t = document.createElement('template'); t.innerHTML = html; return t.content.textContent.replace(/\s+/g, ' ').trim(); };

// steps: [{id, round, phase, title, body, target?, action?, done?, optional?, skip?, when?, final?, actions?}]
export function createCoach({steps, context, announce, load, save, onAction, reduceMotion}) {
  let pos = 0, active = false, minimized = false, shownId = null, contentKey = '', frame = 0, ticker = 0, current = null;
  const root = document.createElement('div');
  root.className = 'coach';
  root.hidden = true;
  root.innerHTML = `<div class="coach-scrim" aria-hidden="true"></div><div class="coach-ring" aria-hidden="true"></div>
    <section class="coach-card" role="dialog" aria-modal="false" aria-labelledby="coach-title" aria-describedby="coach-body" tabindex="-1">
      <div class="coach-bar" aria-hidden="true"><i></i></div><div class="coach-inner"></div></section>
    <button type="button" class="coach-pill" data-coach="expand"></button>`;
  const ring = root.querySelector('.coach-ring'), card = root.querySelector('.coach-card'), inner = root.querySelector('.coach-inner');
  const pill = root.querySelector('.coach-pill'), scrim = root.querySelector('.coach-scrim'), bar = root.querySelector('.coach-bar i');
  document.body.append(root);

  const persist = () => save({pos, active, minimized});
  function restore() {
    const saved = load();
    if (!saved) return false;
    ({pos = 0, active = false, minimized = false} = saved);
    return true;
  }

  function resolve(step, c) {
    const list = [value(step.target, c)].flat().filter(Boolean);
    const found = list.map(sel => document.querySelector(sel)).filter(visible);
    const inView = found.find(el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
    return inView || found[0] || null;
  }

  // Moves past steps whose moment has gone, finished actions and steps that don't apply.
  function settle(c) {
    const now = stage(c.state.round, c.state.phase);
    while (pos < steps.length) {
      const s = steps[pos], at = stage(s.round, s.phase);
      if (at < now || (at === now && ((s.action && s.done(c)) || s.skip?.(c)))) { pos++; continue; }
      break;
    }
  }

  function hide() { root.hidden = true; clearInterval(ticker); ticker = 0; current = null; }

  function sync() {
    if (!active) { hide(); return; }
    const c = context();
    if (!c) { hide(); return; }
    const before = pos;
    settle(c);
    if (pos !== before) persist();
    if (pos >= steps.length) { finish(); return; }
    const s = steps[pos];
    // Waiting for the game to reach this step, or a dialog unrelated to the guide is open.
    if (stage(s.round, s.phase) > stage(c.state.round, c.state.phase) || (s.when && !s.when(c))) { hide(); return; }
    const target = s.target ? resolve(s, c) : null;
    const dialog = document.querySelector('dialog[open]');
    if (dialog && !(target && dialog.contains(target))) { hide(); return; }
    // Fixed positions inside a dialog are only true once its entrance transform has finished.
    if (dialog && getComputedStyle(dialog).transform !== 'none') { hide(); return; }
    const home = dialog || document.body;
    if (root.parentElement !== home) home.append(root);
    show(s, c, target);
  }

  function show(s, c, target) {
    const n = pos + 1, total = steps.length;
    const title = value(s.title, c), body = value(s.body, c), todo = value(s.do, c);
    // A step whose heading changes (review → lock) is new to the player, so it is announced again.
    const fresh = `${s.id}|${title}` !== shownId;
    const back = previous() >= 0;
    const actions = s.final
      ? s.actions.map(([id, label, primary]) => `<button type="button" class="btn ${primary ? 'btn-primary' : ''}" data-coach="act" data-id="${id}">${label}</button>`).join('')
      : `${back ? '<button type="button" class="btn btn-ghost" data-coach="back">Back</button>' : ''}
         ${s.action && s.optional ? '<button type="button" class="btn btn-ghost" data-coach="skip">Skip step</button>' : ''}
         ${s.action ? (target ? '<button type="button" class="btn" data-coach="show">Show me</button>' : '') : `<button type="button" class="btn btn-primary" data-coach="next">${s.next || 'Next'}</button>`}`;
    const key = `${s.id}|${title}|${body}|${todo}|${actions}`;
    if (key !== contentKey) {
      contentKey = key;
      inner.innerHTML = `<div class="coach-head"><span class="coach-count">Guide · step ${n} of ${total}</span>
          <button type="button" class="coach-icon" data-coach="min" aria-label="Minimise the guide" title="Minimise"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg></button>
          ${s.final ? '' : '<button type="button" class="coach-icon" data-coach="end" aria-label="End the guide" title="End guide"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>'}</div>
        <h2 id="coach-title">${title}</h2>
        <div id="coach-body" class="coach-body">${body}</div>
        ${s.action ? `<p class="coach-do"><span aria-hidden="true"></span>${todo || 'Use the highlighted control.'}</p>` : ''}
        <div class="coach-actions">${actions}</div>`;
      bar.style.setProperty('--p', String(n / total));
    }
    pill.innerHTML = `<span aria-hidden="true"></span>Guide · step ${n} of ${total}`;
    pill.setAttribute('aria-label', `Open the guide, step ${n} of ${total}: ${plain(title)}`);
    const wasHidden = root.hidden;
    root.hidden = false;
    root.classList.toggle('min', minimized);
    root.classList.toggle('no-target', !target);
    root.classList.toggle('acting', !!s.action);
    current = {s, target, side: current?.s === s ? current.side : undefined};
    if (fresh) {
      shownId = `${s.id}|${title}`;
      if (!wasHidden && !reduceMotion()) { inner.classList.remove('enter'); void inner.offsetWidth; inner.classList.add('enter'); }
      if (target && !reduceMotion()) { ring.classList.remove('ping'); void ring.offsetWidth; ring.classList.add('ping'); }
      current.side = side(bring(target));
      if (!minimized) attend(n, total, title, body);
    }
    current.side ??= side(target?.getBoundingClientRect());
    layout(fresh && !wasHidden);
    if (!ticker) ticker = setInterval(() => layout(false), 300);
  }

  // Keyboard and screen reader users follow the guide; pointer users keep their focus.
  function attend(n, total, title, body) {
    const a = document.activeElement;
    if (!a || a === document.body || keyboard || root.contains(a)) card.focus({preventScroll: true});
    else announce(`Guide, step ${n} of ${total}: ${plain(title)}. ${plain(body)}`);
  }

  // Scrolls the target into the part of the screen the card leaves free, and returns where the
  // target will end up, so the card can pick its side once instead of jumping while it scrolls.
  function bring(el) {
    if (!el) return null;
    const behavior = reduceMotion() ? 'auto' : 'smooth', r = el.getBoundingClientRect();
    if (el.closest('dialog')) { el.scrollIntoView({block: 'nearest', behavior}); return el.getBoundingClientRect(); }
    if (el.closest('.dock, .topbar, .rail')) return r;
    const m = metrics(), vh = m.vh;
    const top = m.minY + 4, bottom = vh - m.dockH - (m.narrow ? m.ch + 28 : 16);
    if (r.top >= top && r.bottom <= bottom) return r;
    const want = m.narrow || r.height > bottom - top ? top : top + Math.max(0, (bottom - top - r.height) / 2);
    const from = scrollY, end = Math.min(Math.max(0, from + r.top - want), document.documentElement.scrollHeight - vh);
    scrollTo({top: end, behavior});
    const shift = end - from;
    return {top: r.top - shift, bottom: r.bottom - shift, left: r.left, right: r.right, width: r.width, height: r.height};
  }

  const metrics = () => {
    const vw = document.documentElement.clientWidth, vh = innerHeight;
    const inDialog = !!root.closest('dialog'), topH = inDialog ? 0 : pinned('#hdr'), dockH = inDialog ? 0 : pinned('#dock');
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 14, edge = 12;
    return {vw, vh, narrow: vw < 640, dockH, cw, ch, gap, edge, minY: topH + edge, maxY: vh - dockH - ch - edge};
  };

  // Beside the target when there's room; otherwise pinned to the top or bottom edge, whichever
  // leaves the start of the target (where its controls and heading are) uncovered.
  function side(r) {
    const m = metrics();
    if (!r) return m.narrow ? 'bottom' : 'center';
    const headTop = Math.max(r.top, 0), headBottom = Math.min(r.bottom, headTop + 140);
    const covers = y => Math.max(0, Math.min(y + m.ch, headBottom) - Math.max(y, headTop));
    const edge = () => covers(m.maxY) <= covers(m.minY) ? 'bottom' : 'top';
    if (m.narrow) return edge();
    if (r.bottom + m.gap + m.ch <= m.vh - m.dockH - m.edge) return 'below';
    if (r.top - m.gap - m.ch >= m.minY) return 'above';
    if (r.right + m.gap + m.cw <= m.vw - m.edge) return 'right';
    if (r.left - m.gap - m.cw >= m.edge) return 'left';
    return edge();
  }

  function layout(animate) {
    if (!current || root.hidden) return;
    const el = current.target && document.contains(current.target) ? current.target : current.s.target ? resolve(current.s, context()) : null;
    if (current.target !== el) current.target = el;
    root.classList.toggle('instant', !animate);
    const r = el?.getBoundingClientRect(), m = metrics();
    const onScreen = r && r.bottom > 0 && r.top < m.vh;
    ring.hidden = !onScreen;
    scrim.hidden = !!el;
    if (onScreen) {
      const pad = 6;
      ring.style.setProperty('transform', `translate(${Math.round(r.left - pad)}px, ${Math.round(r.top - pad)}px)`);
      ring.style.setProperty('width', `${Math.round(r.width + pad * 2)}px`);
      ring.style.setProperty('height', `${Math.round(r.height + pad * 2)}px`);
    }
    const where = r ? current.side : m.narrow ? 'bottom' : 'center';
    const low = !minimized && where === 'bottom';
    root.classList.toggle('edge-bottom', low);
    // Notices stack above a card sitting on the bottom edge instead of covering its buttons.
    if (low) document.documentElement.style.setProperty('--coach-h', `${Math.round(m.ch + m.edge)}px`);
    if (minimized) return;
    let x = r ? r.left + r.width / 2 - m.cw / 2 : (m.vw - m.cw) / 2, y;
    if (where === 'top') y = m.minY;
    else if (where === 'bottom') y = m.maxY;
    else if (where === 'center') y = (m.vh - m.ch) / 2;
    else if (where === 'below') y = r.bottom + m.gap;
    else if (where === 'above') y = r.top - m.gap - m.ch;
    else if (where === 'right') { x = r.right + m.gap; y = r.top; }
    else if (where === 'left') { x = r.left - m.gap - m.cw; y = r.top; }
    if (m.narrow) x = (m.vw - m.cw) / 2;
    x = Math.min(Math.max(x, m.edge), m.vw - m.cw - m.edge);
    y = Math.min(Math.max(y, m.minY), Math.max(m.minY, m.maxY));
    card.style.setProperty('transform', `translate(${Math.round(x)}px, ${Math.round(y)}px)`);
  }

  function previous() {
    const s = steps[pos];
    for (let i = pos - 1; i >= 0; i--) {
      const p = steps[i];
      if (stage(p.round, p.phase) !== stage(s.round, s.phase)) return -1;
      if (!p.action && !p.skip?.(context())) return i;
    }
    return -1;
  }

  function finish() { active = false; minimized = false; persist(); hide(); }

  function go(next) { pos = next; shownId = null; contentKey = ''; persist(); sync(); }

  root.addEventListener('click', event => {
    const b = event.target.closest('[data-coach]');
    if (!b || !current) return;
    const what = b.dataset.coach;
    if (what === 'next') go(pos + 1);
    else if (what === 'back') { const p = previous(); if (p >= 0) go(p); }
    else if (what === 'skip') go(pos + 1);
    else if (what === 'show') {
      const el = current.target;
      if (!el) return;
      bring(el);
      const focusable = el.matches('button, input, select, textarea, a[href]') ? el : el.querySelector('button:not([disabled]), input:not([disabled])');
      focusable?.focus({preventScroll: true});
    } else if (what === 'min') { minimized = true; persist(); root.classList.add('min'); pill.focus(); }
    else if (what === 'expand') { minimized = false; persist(); root.classList.remove('min'); shownId = null; sync(); card.focus({preventScroll: true}); }
    else if (what === 'end') { finish(); onAction('ended'); }
    else if (what === 'act') { const id = b.dataset.id; finish(); onAction(id); }
  });

  let keyboard = false;
  addEventListener('keydown', e => { if (!e.metaKey && !e.ctrlKey && !e.altKey) keyboard = true; }, true);
  addEventListener('pointerdown', () => { keyboard = false; }, true);

  const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => layout(false)); };
  const onResize = () => { if (current) current.side = side(current.target?.getBoundingClientRect()); onScroll(); };
  addEventListener('scroll', onScroll, {passive: true, capture: true});
  addEventListener('resize', onResize, {passive: true});

  return {
    start(from = 0) { pos = from; active = true; minimized = false; shownId = null; contentKey = ''; persist(); sync(); },
    resume() { if (restore()) { shownId = null; contentKey = ''; sync(); } },
    reopen() { active = true; minimized = false; shownId = null; contentKey = ''; persist(); sync(); return pos < steps.length; },
    stop() { active = false; hide(); },
    detach() { active = false; hide(); if (root.parentElement !== document.body) document.body.append(root); },
    sync,
    get active() { return active; },
    get remaining() { return pos < steps.length; },
  };
}
