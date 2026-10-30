import {isCurrentResponse, snapshotCommand} from './session.js';
import * as M from './model.js';
import {art, icon, drone, mark} from './art.js';

const {SECTORS, GOODS, COMPANIES, TICKERS, CONTRACTS, COMPONENTS, money, units, pct, signedMoney, cents} = M;
const SHORT = ['Belt', 'Cruiser', 'Rift'];
const $ = selector => document.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const forget = key => { try { localStorage.removeItem(key); } catch {} };
const keygen = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const cap = s => s[0].toUpperCase() + s.slice(1);
const plural = (n, one, many = `${one}s`) => `${units(n)} ${n === 1 ? one : many}`;
const list = names => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

let state = null, session = null, draft = M.emptyDraft(), preview = null, previewStatus = 'idle', previewError = '', rivalFactor = 1;
let previewTimer, previewRequest = 0, busy = false, busyId = '', online = true, pending = null, pendingScope = '', sessionGeneration = 0;
let view = 'ops', menuOpen = false, timelineOpen = false, fuelQty = '1', flash = null, entryMode = 'create', landingNotice = '';
let seq = {round: 0, playing: false, timer: 0}, dialogReturn = null, polling = false;
const openKeys = new Set();
const regionKeys = new WeakMap();

// ---------- transport and session ----------

async function api(path, body, key = session?.key) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`/api${path}`, {method: body === undefined ? 'GET' : 'POST',
      headers: {...(body === undefined ? {} : {'Content-Type': 'application/json'}), ...(key ? {'Authorization': `Bearer ${key}`} : {})},
      body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal});
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) { const err = new Error(data.detail || `Request failed (${response.status})`); err.status = response.status; throw err; }
    online = true;
    return data;
  } finally { clearTimeout(timer); }
}

const draftKey = () => `sx-draft-${state.code}-${state.you.seat}-${state.round}`;
const ctx = () => ({you: state.you, prices: state.prices, stocks: state.stocks, rules: state.rules});
const evaluation = () => M.evaluate(draft, ctx());

function accept(next, force = false, requested = session) {
  if (!isCurrentResponse(state, next, requested, session)) return false;
  const prev = state;
  const changed = !prev || prev.code !== next.code || prev.round !== next.round || prev.phase !== next.phase;
  state = next;
  if (changed) {
    preview = null; previewRequest++; previewStatus = 'idle';
    draft = next.you.plan ? M.draftFromPlan(next.you.plan) : M.normalizeDraft(read(draftKey()));
    if (prev && prev.code === next.code) { view = 'ops'; flash = null; announce(phaseAnnouncement()); }
    startSequenceIfNew();
    if (prev && prev.code === next.code) window.scrollTo({top: 0});
  }
  if (next.you.locked && next.you.plan) draft = M.draftFromPlan(next.you.plan);
  render();
  if (changed) schedulePreview();
  return true;
}

function phaseAnnouncement() {
  const r = state.round;
  return {briefing: `Round ${r} briefing.`, planning: `Round ${r} planning is open.`, upgrade: `Round ${r} settled. Results are ready.`,
    finished: 'Match complete. Final results are ready.', lobby: 'Lobby.'}[state.phase];
}

async function command(kind, args = {}, scope = kind) {
  if (busy) return;
  if (pending) { setFlash('general', 'Finish the action waiting for confirmation first. Use “Retry safely”; its receipt prevents duplicate charges.'); return; }
  flash = null;
  pending = snapshotCommand({kind, ...args, request_id: crypto.randomUUID(), round: state.round, phase: state.phase});
  pendingScope = scope;
  save(`sx-pending-${session.code}`, {owner: session.key, command: pending, scope});
  await sendPending();
}

async function sendPending() {
  if (!pending || busy) return;
  const requested = {...session};
  busy = true; render();
  try {
    const result = await api(`/rooms/${requested.code}/commands`, pending, requested.key);
    if (!isCurrentResponse(state, result, requested, session)) return;
    const done = pending;
    pending = null; forget(`sx-pending-${requested.code}`);
    busy = false;
    accept(result, true, requested);
    confirmed(done);
  } catch (err) {
    if (err.status) {
      pending = null; forget(`sx-pending-${requested.code}`);
      setFlash(pendingScope || 'general', friendly(err.message));
    } else announce('Action not confirmed. Retry safely.');
  } finally { busy = false; busyId = ''; render(); }
}

function confirmed(cmd) {
  const k = cmd.kind;
  if (k === 'lock') announce('Plan locked.');
  else if (k === 'ready' && state.phase === cmd.phase) announce('You are ready. Waiting for other crews.');
  else if (k === 'scan') toast('Scan complete. The result is private to you.');
  else if (k === 'purchase') toast({fuel: `Fuel added: ${cmd.quantity} unit${cmd.quantity === 1 ? '' : 's'}.`, drone: 'Drone purchased. It joins your fleet next round.',
    repair: 'Drone repaired.', insurance: 'Insurance bought for next round.', scanner: 'Scanner installed. Scans now cost 10 cr.', retire: 'Drone retired.'}[cmd.item]);
}

const FRIENDLY = {
  'insufficient reserved credits': 'The plan reserves more credits than you have.',
  'insufficient fuel': 'The plan needs more fuel than your tank holds.',
  'bid without capacity': 'A bid needs at least one of your drones in that sector.',
  'invalid bid': 'Bids must be whole credits from 1 to 120, or 0.',
  'order limit': 'An order is over the per-round limit.',
  'short sale': 'A sell order is larger than what you hold.',
  'position limit': 'A buy would take you over the holding limit.',
  'unavailable drone': 'A drone in the plan is unavailable.',
  'invalid fuel purchase': 'That fuel purchase isn’t possible: the tank holds 16 and each unit costs 8 cr.',
  'unavailable drone purchase': 'You can’t buy a drone: the fleet limit is 5 and a drone costs 260 cr.',
  'unaffordable scan': 'Not enough credits for that scan.',
  'scan target already bought or scan limit': 'You already scanned that, or used both scans this round.',
};
const friendly = message => FRIENDLY[message] || message;

function draftChanged() { save(draftKey(), draft); updateLive(); schedulePreview(); }

function schedulePreview() {
  clearTimeout(previewTimer);
  if (!state || state.phase !== 'planning' || state.you.locked) return;
  const ev = evaluation(), ticket = ++previewRequest;
  if (M.blocksEstimate(ev.errors)) { previewStatus = 'paused'; renderEstimate(); return; }
  previewStatus = 'loading'; renderEstimate();
  const requested = {...session};
  previewTimer = setTimeout(async () => {
    try {
      const result = await api(`/rooms/${requested.code}/preview`, {plan: ev.plan, rival_factor: rivalFactor}, requested.key);
      if (ticket !== previewRequest || requested.generation !== session?.generation) return;
      preview = result; previewStatus = 'ready';
    } catch (err) {
      if (ticket !== previewRequest) return;
      previewStatus = 'error'; previewError = err.name === 'AbortError' ? 'the server did not answer in time' : err.message;
    }
    renderEstimate();
  }, 250);
}

// ---------- feedback ----------

function toast(text) {
  const n = $('#notice');
  n.textContent = text; n.className = 'visible';
  clearTimeout(toast.timer); toast.timer = setTimeout(() => n.className = '', 5000);
}
function announce(text) {
  const a = $('#announcer');
  a.textContent = '';
  setTimeout(() => a.textContent = text, 60);
}
function setFlash(scope, text) {
  flash = {scope, text};
  render();
  if (!$(`[data-error-scope="${scope}"]`)) announce(text);
}

// ---------- region rendering ----------

// Replaces a region only when its key changes, keeping focus and caret in place.
function patch(el, key, make) {
  if (!el) return;
  const html = key === null ? make : null;
  const k = key === null ? html : key;
  if (regionKeys.get(el) === k) return;
  const active = document.activeElement, inside = active && el.contains(active) ? active : null;
  const id = inside?.id;
  let selection = null;
  try { if (inside && typeof inside.selectionStart === 'number') selection = [inside.selectionStart, inside.selectionEnd]; } catch {}
  el.innerHTML = html ?? make();
  regionKeys.set(el, k);
  if (id) {
    const next = document.getElementById(id);
    if (next) { next.focus({preventScroll: true}); if (selection) try { next.setSelectionRange(...selection); } catch {} }
  }
}

const disclosure = (key, summary, body, cls = '') =>
  `<details class="disclosure ${cls}" data-key="${key}" ${openKeys.has(key) ? 'open' : ''}><summary>${summary}${icon('chevron', 'chev')}</summary><div class="disclosure-body">${body}</div></details>`;
const btn = (label, action, {cls = '', id = '', attrs = ''} = {}) =>
  `<button type="button" class="btn ${cls}" data-action="${action}"${id ? ` id="${id}"` : ''} ${attrs}>${label}</button>`;
const cmdBtn = (label, action, {cls = '', id, attrs = '', off = ''} = {}) =>
  `${btn(label, action, {cls, id, attrs: `data-cmd ${off ? 'data-off disabled' : ''} ${off ? `aria-describedby="${id}-why"` : ''} ${attrs}`})}${off ? `<p class="why" id="${id}-why">${off}</p>` : ''}`;
const tone = n => cents(n) > 0 ? 'pos' : cents(n) < 0 ? 'neg' : 'flat';
const delta = (n, suffix = '') => `<span class="delta ${tone(n)}">${cents(n) > 0 ? icon('up') : cents(n) < 0 ? icon('down') : ''}${signedMoney(n)}${suffix}</span>`;
const move = (from, to) => { const r = to / from - 1; return `<span class="delta ${tone(r * 100)}">${cents(r * 100) > 0 ? icon('up') : cents(r * 100) < 0 ? icon('down') : ''}${pct(r)}</span>`; };
const goodTag = j => `<span class="good s${j}"><i aria-hidden="true"></i>${GOODS[j]}</span>`;
const pageHead = (kicker, title, lede) => `<header class="page-head"><p class="kicker">${kicker}</p><h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ''}</header>`;
const errorSlot = scope => `<p class="field-error" data-error-scope="${scope}" role="alert" hidden></p>`;
const fieldError = (key, input = '') => `<p class="field-error" id="err-${key}" data-field-error="${key}" ${input ? `data-for="${input}"` : ''} hidden></p>`;
// Writes only real changes, so polling never re-triggers live regions or alerts.
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; if (el.hidden !== !text) el.hidden = !text; };
const avatar = (p) => `<span class="avatar a${p.seat}" aria-hidden="true">${esc(p.name.slice(0, 2).toUpperCase())}</span>`;
const nameOf = seat => esc(state.players[seat]?.name ?? `Seat ${seat + 1}`);
const droneName = id => Number(id) === -1 ? 'Recovery drone' : `Drone ${Number(id) + 1}`;

function render() {
  if (!state) { renderLanding(); return; }
  ensureShell();
  document.body.dataset.phase = state.phase;
  patch($('#hdr'), null, headerHtml());
  patch($('#rail'), null, railHtml());
  patch($('#dock'), null, dockHtml());
  renderMain();
  renderStatus();
  updateLive();
}

function ensureShell() {
  if ($('#shell')) return;
  $('#app').innerHTML = `<div id="shell" class="shell">
    <header id="hdr" class="topbar"></header>
    <div class="layout"><main id="main" tabindex="-1"><div id="status"></div><div id="regions"></div></main>
    <aside id="rail" class="rail" aria-label="Your corporation and crews"></aside></div>
    <footer class="foot"><span>Salvage Exchange · frozen economy v0.2 · alpha</span><span>Estimates are estimates. Rival plans stay sealed until every crew locks.</span></footer>
    <section id="dock" class="dock" aria-label="Your position"></section></div>`;
  const dock = $('#dock'), top = $('#hdr'), root = document.documentElement.style;
  new ResizeObserver(() => root.setProperty('--dock-h', `${dock.offsetHeight}px`)).observe(dock);
  new ResizeObserver(() => root.setProperty('--top-h', `${getComputedStyle(top).position === 'sticky' ? top.offsetHeight : 0}px`)).observe(top);
}

function renderMain() {
  const host = $('#regions'), regions = mainRegions(), ids = regions.map(r => r.id).join('|');
  if (host.dataset.ids !== ids) {
    host.innerHTML = regions.map(r => `<div class="region" id="r-${r.id}"></div>`).join('');
    host.dataset.ids = ids;
  }
  for (const r of regions) patch($(`#r-${r.id}`), r.key, r.html);
}

function mainRegions() {
  const s = state, y = s.you, crew = JSON.stringify(s.players.map(p => [p.name, p.online, p.ready, p.locked]));
  if (view === 'ledger') return [{id: 'ledger', key: `${s.code}|${s.history.length}|${y.reports?.length}`, html: ledgerHtml}];
  if (s.phase === 'lobby') return [{id: 'lobby', key: `${s.code}|${crew}`, html: lobbyHtml}];
  const mine = JSON.stringify([s.round, y.credits, y.fuel, y.drones, y.scans, y.ready, y.locked, y.recovery, y.scanner, y.inventory, y.shares, y.contracts]);
  if (s.phase === 'briefing') return [{id: 'brief', key: `${mine}|${crew}`, html: briefingHtml}];
  if (s.phase === 'planning') return y.locked
    ? [{id: 'locked', key: `${mine}|${crew}`, html: lockedHtml}]
    : [{id: 'plan', key: `${mine}|${s.players.length}`, html: planningHtml}];
  const log = s.history.at(-1), report = (y.reports || []).find(r => r.round === log?.round);
  const reveal = {id: 'reveal', key: `${s.code}|${log?.round}|${!!report}`, html: () => roundHtml(log, report, true)};
  if (s.phase === 'finished') return [{id: 'final', key: `${s.code}|final|${narrow()}`, html: finalHtml}, reveal];
  return [reveal, {id: 'refit', key: `${mine}|${crew}`, html: refitHtml}];
}

function renderStatus() {
  const parts = [];
  if (pending) {
    const what = pendingLabel(pending);
    parts.push(busy
      ? `<div class="banner info" role="status">${icon('sync', 'spin')}<div><b>Sending: ${what}</b><p>Waiting for the server to confirm.</p></div></div>`
      : `<div class="banner warn" role="alert">${icon('alert')}<div><b>Not confirmed: ${what}</b><p>We couldn’t confirm this with the server. Retrying is safe: the server recognises the same request and won’t charge or lock twice.</p></div>${btn('Retry safely', 'retry', {cls: 'btn-sm', id: 'retry'})}</div>`);
  }
  if (!online) parts.push(`<div class="banner warn" role="status">${icon('sync', 'spin')}<div><b>Reconnecting…</b><p>Your draft is saved on this device. Nothing is sent until the connection returns.</p></div></div>`);
  if (flash && (flash.scope === 'general' || !$(`[data-error-scope="${flash.scope}"]`)))
    parts.push(`<div class="banner error" role="alert">${icon('alert')}<div><b>That didn’t go through</b><p>${esc(flash.text)}</p></div>${btn(`${icon('close')}<span class="sr-only">Dismiss</span>`, 'dismiss', {cls: 'btn-icon', id: 'dismiss-flash'})}</div>`);
  patch($('#status'), null, parts.join(''));
}

function pendingLabel(cmd) {
  return {lock: 'lock plan', ready: 'mark ready', start: 'start match', scan: 'private scan',
    purchase: `${{fuel: 'buy fuel', drone: 'buy drone', repair: 'repair', insurance: 'insurance', scanner: 'buy scanner', retire: 'retire drone'}[cmd.item] || 'purchase'}`}[cmd.kind] || cmd.kind;
}

// ---------- header, rail and dock ----------

function headerHtml() {
  const s = state, steps = M.timeline(s.phase, s.round);
  const round = s.phase === 'lobby' ? 'Lobby' : `Round ${s.round} of 6`;
  return `<div class="topbar-inner">
    <div class="brand">${mark()}<span>Salvage Exchange</span></div>
    <div class="room"><span class="room-label">Room</span><span class="room-code">${s.code}</span>
      ${btn(`${icon('copy')}<span class="sr-only">Copy room code ${s.code.split('').join(' ')}</span>`, 'copy-code', {cls: 'btn-icon', id: 'copy-code'})}</div>
    <div class="phase"><span class="round-label">${round}</span>
      <button type="button" class="phase-now" id="phase-toggle" data-action="timeline" aria-expanded="${timelineOpen}" aria-controls="timeline">
        <span>${round}</span><b>${M.phaseLabel(s.phase)}</b>${icon('chevron', 'chev')}</button>
      <ol id="timeline" class="timeline ${timelineOpen ? 'open' : ''}" aria-label="Round sequence">${steps.map((st, i) =>
        `<li class="${st.state}" ${st.state === 'current' ? 'aria-current="step"' : ''}><span class="tl-dot">${st.state === 'done' ? icon('check') : i + 1}</span><span class="tl-label">${st.label}</span>${st.key === 'settlement' ? '<span class="sr-only"> (automatic)</span>' : ''}</li>`).join('')}</ol>
    </div>
    <div class="tools">
      <span class="conn ${online ? '' : 'off'}" title="${online ? 'Connected' : 'Reconnecting'}"><span class="conn-label">${online ? 'Live' : 'Reconnecting…'}</span></span>
      <div class="tabs" role="group" aria-label="View">
        ${btn(`${icon('ops')}<span class="tab-label">Operations</span>`, 'view', {cls: 'tab', id: 'tab-ops', attrs: `title="Operations" data-view="ops" aria-pressed="${view === 'ops'}"`})}
        ${btn(`${icon('ledger')}<span class="tab-label">Ledger</span>`, 'view', {cls: 'tab', id: 'tab-ledger', attrs: `title="Ledger" data-view="ledger" aria-pressed="${view === 'ledger'}"`})}</div>
      <div class="menu-wrap">
        ${btn(`${icon('menu')}<span>Menu</span>`, 'menu', {cls: 'btn-ghost menu-btn', id: 'menu-toggle', attrs: `aria-expanded="${menuOpen}" aria-controls="menu"`})}
        <div id="menu" class="menu ${menuOpen ? 'open' : ''}">
          ${btn(`${icon('ops')}Operations`, 'view', {cls: 'menu-item only-narrow', id: 'menu-ops', attrs: `data-view="ops" aria-pressed="${view === 'ops'}"`})}
          ${btn(`${icon('ledger')}Ledger`, 'view', {cls: 'menu-item only-narrow', id: 'menu-ledger', attrs: `data-view="ledger" aria-pressed="${view === 'ledger'}"`})}
          ${btn(`${icon('help')}How to play`, 'help', {cls: 'menu-item', id: 'menu-help'})}
          ${btn(`${icon('key')}Your rejoin key`, 'key', {cls: 'menu-item', id: 'menu-key'})}
          ${btn(`${icon('leave')}Back to start screen`, 'home', {cls: 'menu-item', id: 'menu-home'})}
        </div></div>
    </div></div>`;
}

const total = b => M.sum(Object.values(b));

function worthHtml() {
  const y = state.you, b = y.breakdown;
  const objective = y.objective ? `<div class="obj-detail"><p><b>${esc(y.objective)}</b> <span class="hint">· ${state.phase === 'finished' ? 'revealed' : 'rivals see it only at the end'}</span></p>
    <p class="hint">${M.OBJECTIVES[y.objective]}</p>
    <progress max="${state.rules.objective_cap}" value="${b.objective}" aria-label="Objective bonus: ${money(b.objective)} of ${money(state.rules.objective_cap)} cr"></progress></div>` : '';
  return `<section class="rail-card worth" aria-labelledby="worth-title">
    <h2 id="worth-title" class="rail-title">Your net worth <span class="note">includes your private objective</span></h2>
    <p class="worth-total num">${money(total(b))}<small>cr</small></p>
    <dl class="worth-list">${COMPONENTS.map(([k, label]) => `<div class="wl-${k}"><dt>${label}<span class="hint">${{credits: 'spendable', contracts: 'score', fleet: 'book value', objective: 'private', stocks: 'at market', salvage: 'at market'}[k]}</span></dt><dd class="num">${money(b[k])}</dd></div>`).join('')}</dl>
    ${objective}
    ${btn('What counts?', 'worth', {cls: 'btn-link', id: 'worth-rail'})}
  </section>`;
}

function waitingNote() {
  const waiting = M.waitingFor(state.players, state.phase).filter(p => p.seat !== state.you.seat);
  if (!waiting.length) return '';
  return `Waiting for ${list(waiting.map(p => `${esc(p.name)}${p.online ? '' : ' (offline)'}`))}.`;
}

function actionCardHtml() {
  const s = state, y = s.you;
  const card = (title, body) => `<section class="rail-card action" aria-labelledby="action-title"><h2 id="action-title" class="rail-title">${title}</h2>${body}</section>`;
  if (s.phase === 'lobby') return card('Next step', s.you.seat === 0 ? startButton('start-rail') : `<p>Waiting for ${nameOf(0)} to start the match.</p>`);
  if (s.phase === 'briefing') return card(y.ready ? 'You’re ready' : 'Next step', y.ready
    ? `<p>${waitingNote() || 'Opening planning…'}</p><p class="hint">Planning opens when every crew is ready.</p>`
    : `${cmdBtn('Ready for planning', 'ready', {cls: 'btn-primary btn-block', id: 'ready-rail'})}<p class="hint">Scans and fuel purchases close once you’re ready.</p>`);
  if (s.phase === 'planning') return card(y.locked ? 'Plan locked' : `Round ${s.round} plan`, y.locked
    ? `<p class="ok">${icon('check')}Your plan is sealed.</p><p>${waitingNote() || 'Settling…'}</p><p class="hint">Settlement runs the moment the last crew locks. There’s no timer.</p>`
    : `<dl class="plan-stats">
        <div><dt>Reserved now</dt><dd class="num" data-live="reserved">0.00</dd></div>
        <div><dt>Credits left</dt><dd class="num" data-live="available">${money(y.credits)}</dd></div>
        <div><dt>Fuel committed</dt><dd class="num" data-live="fuel">0 of ${y.fuel}</dd></div>
        <div><dt>Drones</dt><dd data-live="drones">—</dd></div></dl>
      <p class="plan-check" data-live="check"></p>
      ${btn(`${icon('lock')}Review plan`, 'review', {cls: 'btn-primary btn-block', id: 'review-rail'})}
      <p class="hint">Change anything until you lock.</p>`);
  if (s.phase === 'upgrade') return card(y.ready ? 'Refit ready' : 'Next step', y.ready
    ? `<p>${waitingNote() || 'Starting the next round…'}</p>`
    : `${cmdBtn(`Ready for round ${s.round + 1}`, 'ready', {cls: 'btn-primary btn-block', id: 'ready-rail'})}<p class="hint">Purchases apply next round. Every crew must be ready to continue.</p>`);
  return card('Match complete', btn('Back to start screen', 'home', {cls: 'btn-block', id: 'home-rail'}));
}

function startButton(id) {
  const n = state.players.length;
  return cmdBtn('Start match', 'start', {cls: 'btn-primary btn-block', id, off: n < 2 ? `Needs at least 2 crews; ${n} joined. Share the room code.` : ''});
}

// Crew presence, phase status and public standing in one ranked list.
function crewsHtml() {
  const s = state, final = s.phase === 'finished', lobby = s.phase === 'lobby';
  return `<section class="rail-card crews" aria-labelledby="crews-title"><h2 id="crews-title" class="rail-title">Crews <span class="note">${lobby ? `${s.players.length} of 4 seats` : final ? 'final scores, objectives included' : 'public value, objectives excluded'}</span></h2>
    <ol class="crew-list">${M.ranked(s.players).map(p => { const st = M.crewStatus(p, s.phase);
      return `<li class="crew ${st.done ? 'done' : ''} ${st.offline ? 'offline' : ''} ${p.seat === s.you.seat ? 'me' : ''}">${avatar(p)}<span class="crew-name">${esc(p.name)}${p.seat === s.you.seat ? '<span class="badge">You</span>' : ''}${p.host && lobby ? '<span class="badge">Host</span>' : ''}</span>
        <span class="crew-status">${st.done && !lobby ? icon('check') : ''}${st.label}</span>
        ${lobby ? '' : `<span class="crew-value num"><span class="sr-only">Rank ${p.rank}, </span>${money(p.networth)}</span>`}</li>`; }).join('')}</ol></section>`;
}

function railHtml() { return `${worthHtml()}${actionCardHtml()}${crewsHtml()}`; }

function dockHtml() {
  const s = state, y = s.you, b = y.breakdown;
  let stats, action;
  const stat = (label, value, live = '') => `<div class="dock-stat"><span>${label}</span><b class="num" ${live ? `data-live="${live}"` : ''}>${value}</b></div>`;
  if (s.phase === 'planning' && !y.locked) {
    stats = stat('Credits left', money(y.credits), 'available') + stat('Fuel', `0 of ${y.fuel}`, 'fuel');
    action = btn(`${icon('lock')}Review plan`, 'review', {cls: 'btn-primary', id: 'review-dock'});
  } else {
    stats = stat('Credits', money(y.credits)) + stat('Fuel', `${y.fuel} of 16`);
    const waiting = M.waitingFor(s.players, s.phase).filter(p => p.seat !== y.seat).length;
    const status = text => `<p class="dock-status">${text}</p>`;
    if (s.phase === 'lobby') action = y.seat === 0 ? cmdBtn('Start match', 'start', {cls: 'btn-primary', id: 'start-dock', off: s.players.length < 2 ? 'Needs 2 crews' : ''}) : status('Waiting for host');
    else if (s.phase === 'briefing') action = y.ready ? status(`Ready · waiting for ${waiting}`) : cmdBtn('Ready for planning', 'ready', {cls: 'btn-primary', id: 'ready-dock'});
    else if (s.phase === 'planning') action = status(`${icon('check')}Locked · waiting for ${waiting}`);
    else if (s.phase === 'upgrade') action = y.ready ? status(`Ready · waiting for ${waiting}`) : cmdBtn(`Ready for round ${s.round + 1}`, 'ready', {cls: 'btn-primary', id: 'ready-dock'});
    else action = btn('New game', 'home', {cls: 'btn-primary', id: 'home-dock'});
  }
  return `<div class="dock-inner"><div class="dock-row">${stats}<div class="dock-action">${action}</div></div>
    <dl class="dock-worth"><div class="dw-total"><dt>Net worth</dt><dd class="num">${money(total(b))}</dd></div>
    ${COMPONENTS.map(([k, label]) => `<div class="dw-${k}"><dt>${label}</dt><dd class="num">${money(b[k])}</dd></div>`).join('')}
    <div class="dw-more">${btn(`${icon('info')}<span>Info</span>`, 'worth', {cls: 'btn-ghost', id: 'worth-dock', attrs: 'aria-label="Explain net worth"'})}</div></dl></div>`;
}

// ---------- live, draft-derived values ----------

function setLive(key, text, cls) {
  for (const el of $$(`[data-live="${key}"]`)) { if (el.textContent !== text) el.textContent = text; if (cls !== undefined) el.dataset.tone = cls; }
}

function updateLive() {
  if (!state) return;
  for (const el of $$('[data-error-scope]')) setText(el, flash && flash.scope === el.dataset.errorScope ? flash.text : '');
  for (const el of $$('[data-cmd]')) {
    el.disabled = busy || !!pending || el.hasAttribute('data-off');
    el.classList.toggle('is-pending', busy && el.id === busyId);
    if (busy && el.id === busyId) el.setAttribute('aria-busy', 'true'); else el.removeAttribute('aria-busy');
  }
  if (state.phase === 'briefing' || state.phase === 'upgrade') updateFuelControl();
  if (state.phase !== 'planning' || state.you.locked) return;
  const ev = evaluation(), t = ev.totals;
  const plan = $('#plan-form');
  if (plan) plan.toggleAttribute('inert', busy && pending?.kind === 'lock');
  for (const chip of $$('[data-action="assign"]')) chip.setAttribute('aria-pressed', String(draft.allocation[chip.dataset.drone] === Number(chip.dataset.sector)));
  for (const el of $$('[data-live-drone]')) {
    const s = draft.allocation[el.dataset.liveDrone], item = el.closest('.fleet-item');
    if (item?.classList.contains('disabled')) continue;
    el.textContent = s === undefined ? 'Idle at port' : `→ ${SECTORS[s]}`;
    item?.classList.toggle('assigned', s !== undefined);
  }
  for (const j of [0, 1, 2]) {
    const ids = Object.keys(ev.plan.allocation).filter(id => ev.plan.allocation[id] === j);
    const normal = ids.filter(id => id !== '-1').length;
    setLive(`sector-${j}`, ids.length
      ? `${plural(ids.length, 'drone')} going · ${normal * state.rules.fuel_use[j]} fuel · ${money(normal * state.rules.deploy_cost)} cr · up to ${units(M.sum(ids.map(id => id === '-1' ? 1.5 : state.rules.capacity[j])))} units`
      : 'No drones going');
    $(`#sector-${j}`)?.classList.toggle('active', ids.length > 0);
  }
  for (const el of $$('[data-field-error]')) {
    const msg = ev.errors[el.dataset.fieldError] || '';
    setText(el, msg);
    if (el.dataset.for) document.getElementById(el.dataset.for)?.setAttribute('aria-invalid', String(!!msg));
  }
  for (const kind of ['cargo', 'shares']) for (const j of [0, 1, 2]) {
    const o = draft[kind][j], row = $(`#row-${kind}-${j}`), m = ev.maxima[kind][j];
    if (!row) continue;
    row.dataset.side = o.side;
    for (const side of ['buy', 'sell', 'hold']) $(`#side-${kind}-${j}-${side}`)?.setAttribute('aria-pressed', String(o.side === side));
    const line = ev.lines.find(l => l.kind === kind && l.j === j);
    setLive(`cash-${kind}-${j}`, !line ? 'No order' : line.side === 'buy'
      ? `Reserves ${money(-line.cash)} cr now, including ${money(line.fee)} fee`
      : `+${money(line.cash)} cr after settlement (${money(line.fee)} fee); not usable this round`, line ? line.side : 'hold');
    setLive(`limit-${kind}-${j}`, o.side === 'buy' ? `You can buy up to ${units(m.buy)} now, set by ${m.why}.`
      : o.side === 'sell' ? (m.sell > 0 ? `You can sell up to ${units(m.sell)}: what you hold now, within the ${units(m.limit)}-per-round limit.` : 'You hold none to sell yet.')
      : kind === 'shares' ? `Up to ${m.limit} per round; hold at most ${m.cap}.` : `Up to ${units(m.limit)} per round; buys can’t take you above ${m.cap}.`);
    const maxBtn = $(`#max-${kind}-${j}`), most = o.side === 'sell' ? m.sell : m.buy;
    if (maxBtn) {
      maxBtn.setAttribute('aria-label', `Set ${kind === 'shares' ? COMPANIES[j] : GOODS[j]} to the maximum, ${units(most)}`);
      maxBtn.disabled = most <= 0;
    }
  }
  for (const j of [0, 1, 2]) { const c = $(`#contract-${j}`); if (c && !c.disabled) c.checked = !!draft.contracts[j]; }
  setLive('reserved', money(t.reserved));
  setLive('available', money(t.available), cents(t.available) < 0 ? 'neg' : '');
  setLive('fuel', `${t.fuel} of ${t.tank}`, t.fuel > t.tank ? 'neg' : '');
  setLive('drones', `${t.assigned} sent · ${t.idle} idle${t.disabled ? ` · ${t.disabled} disabled` : ''}`);
  const issues = Object.keys(ev.errors).length;
  setLive('check', ev.valid ? 'Plan is valid. Review it, then lock.' : `${issues} ${issues === 1 ? 'thing needs' : 'things need'} fixing before you can lock.`, ev.valid ? 'pos' : 'neg');
  renderEstimate();
}

function updateFuelControl() {
  const y = state.you, room = Math.min(16 - y.fuel, Math.floor(y.credits / state.rules.fuel_cost));
  const t = String(fuelQty).trim(), q = Number(t), ok = /^\d{1,2}$/.test(t) && q >= 1 && q <= room;
  const err = $('#err-fuel-qty'), b = $('#buy-fuel');
  if (err) {
    const msg = ok || t === '' ? '' : room < 1 ? (y.fuel >= 16 ? 'Your tank is full (16).' : 'Not enough credits for fuel.') : `Enter a whole number from 1 to ${room}.`;
    err.textContent = msg; err.hidden = !msg;
    $('#fuel-qty')?.setAttribute('aria-invalid', String(!!msg));
  }
  if (b) {
    b.innerHTML = ok ? `Buy ${plural(q, 'unit')} · ${money(q * state.rules.fuel_cost)} cr` : 'Buy fuel';
    b.toggleAttribute('data-off', !ok || y.ready);
    b.disabled = busy || !!pending || !ok || y.ready;
  }
}

// ---------- shared pieces ----------

function oddsBar(j) {
  const o = M.hazardOdds(state.rules, j), p = v => Math.round(v * 100);
  return `<div class="odds" role="img" aria-label="Hazard odds: ${p(o.clear)}% clear, ${p(o.half)}% disruption, ${p(o.severe)}% severe">
    <svg class="odds-bar" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect class="o-clear" width="${p(o.clear)}" height="4"/><rect class="o-half" x="${p(o.clear)}" width="${p(o.half)}" height="4"/><rect class="o-severe" x="${p(o.clear) + p(o.half)}" width="${p(o.severe)}" height="4"/></svg>
    <ul class="odds-legend" aria-hidden="true"><li><i class="o-clear"></i>${p(o.clear)}% clear</li><li><i class="o-half"></i>${p(o.half)}% half yield</li><li><i class="o-severe"></i>${p(o.severe)}% severe</li></ul></div>`;
}

function scanResult(j) {
  const scan = state.you.scans.find(x => x.target === 'hazard' && x.sector === j);
  if (!scan) return '';
  const h = M.hazardResult(scan.value);
  return `<p class="scan-result"><span class="private">${icon('lock')}Your private scan</span><b class="tone-${h.tone}">${h.label}</b><span>${h.effect}</span></p>`;
}

function scanOff(target, j) {
  const y = state.you, cost = y.scanner ? state.rules.upgraded_scan_cost : state.rules.scan_cost;
  if (y.ready) return 'Scans closed: you’re marked ready.';
  if (y.scans.length >= 2) return 'You’ve used both scans this round.';
  if (y.credits < cost) return `Needs ${money(cost)} cr.`;
  return '';
}

function sectorHtml(j, mode) {
  const r = state.rules, n = state.players.length;
  return `<article class="sector s${j}" id="sector-${j}" aria-labelledby="sector-${j}-name">
    <div class="sector-art">${art(j)}</div>
    <div class="sector-info">
      <h3 id="sector-${j}-name">${SECTORS[j]}</h3>
      <p class="sector-yield">${goodTag(j)}<span>${units(r.capacity[j])} per drone</span></p>
      <dl class="facts"><div><dt>Shared reserve</dt><dd>${units(r.reserve[j] * n)} units this round</dd></div>
        <div><dt>Each drone sent</dt><dd>${r.fuel_use[j]} fuel + ${money(r.deploy_cost)} cr</dd></div></dl>
      ${oddsBar(j)}${scanResult(j)}
      ${mode === 'brief' && !state.you.scans.some(x => x.target === 'hazard' && x.sector === j)
        ? cmdBtn(`Scan hazard · ${money(state.you.scanner ? r.upgraded_scan_cost : r.scan_cost)} cr`, 'scan', {cls: 'btn-sm', id: `scan-h-${j}`, attrs: `data-target="hazard" data-sector="${j}"`, off: scanOff('hazard', j)})
        : ''}
    </div>
    ${mode === 'plan' ? `<div class="sector-controls">${chipsHtml(j)}${bidHtml(j)}</div>` : ''}
  </article>`;
}

function chipsHtml(j) {
  const fleet = M.fleetFor(state.you);
  return `<fieldset class="chips"><legend>Send drones</legend><div class="chip-row">${fleet.map(d => {
    const id = String(d.id), blocked = d.disabled ? 'Disabled' : d.recovery && j !== 0 ? 'Belt only' : '';
    return `<button type="button" class="chip" id="chip-${id}-${j}" data-action="assign" data-drone="${id}" data-sector="${j}" aria-pressed="${draft.allocation[id] === j}" ${blocked ? 'disabled' : ''}
      aria-label="Send ${droneName(id)} to ${SECTORS[j]}${blocked ? ` (${blocked.toLowerCase()})` : ''}">${drone()}<span>${droneName(id)}</span>${blocked ? `<small>${blocked}</small>` : d.insured ? '<small>Insured</small>' : ''}</button>`;
  }).join('')}</div></fieldset><p class="sector-sum" data-live="sector-${j}">No drones going</p>`;
}

function bidHtml(j) {
  const rec = state.you.recovery, r = state.rules;
  return `<div class="bid"><label for="bid-${j}">Access bid <span class="opt">optional</span></label>
    <div class="unit-input"><input id="bid-${j}" data-field="bid" data-j="${j}" inputmode="numeric" autocomplete="off" value="${esc(draft.bids[j])}" ${rec ? 'disabled' : ''} aria-describedby="err-bid-${j} bid-${j}-note"><span aria-hidden="true">cr</span></div>
    <p class="hint" id="bid-${j}-note">${rec ? 'Your recovery drone already has protected Belt access.' : `0 shares the reserve. ${r.bid_min}–${r.bid_max} cr bids for exclusive access.`}</p>
    ${fieldError(`bid-${j}`, `bid-${j}`)}
    ${disclosure(`bid-help-${j}`, 'How access works', `<p><b>No bid (0):</b> every crew that sends drones here shares the reserve in proportion to the drones sent.</p>
      <p><b>Positive bid:</b> bids are sealed. The highest bidder gets the sector alone and pays its bid; ties are drawn at random. Losing bids are returned in full.</p>
      <p><b>If you lose:</b> your drones here still use their fuel and ${money(r.deploy_cost)} cr deployment each, bring back nothing, and avoid this sector’s hazard.</p>`, 'small')}</div>`;
}

function fleetHtml() {
  const fleet = M.fleetFor(state.you);
  return `<ul class="fleet" aria-label="Your fleet">${fleet.map(d => `<li class="fleet-item ${d.disabled ? 'disabled' : ''} ${d.insured ? 'insured' : ''}">
    ${drone()}<span class="fi-name">${droneName(d.id)}</span>
    <span class="fi-state" data-live-drone="${d.id}">${d.disabled ? 'Disabled · repair at refit' : 'Idle at port'}</span>
    <span class="fi-meta">${d.recovery ? 'Temporary · no book value' : `${d.insured ? 'Insured · ' : ''}${money(d.value)} book value`}</span></li>`).join('')}</ul>`;
}

function stepper(id, value, {action, attrs = '', label, mode = 'decimal'}) {
  return `<div class="stepper">
    ${btn(icon('minus'), action, {cls: 'btn-icon', id: `${id}-dec`, attrs: `${attrs} data-step="-1" aria-label="Decrease ${label}"`})}
    <input id="${id}" class="num" ${attrs} inputmode="${mode}" autocomplete="off" value="${esc(value)}" aria-label="${label}">
    ${btn(icon('plus'), action, {cls: 'btn-icon', id: `${id}-inc`, attrs: `${attrs} data-step="1" aria-label="Increase ${label}"`})}</div>`;
}

function orderHtml(kind, j) {
  const whole = kind === 'shares', y = state.you, quote = (whole ? state.stocks : state.prices)[j], held = (whole ? y.shares : y.inventory)[j];
  const name = whole ? COMPANIES[j] : GOODS[j], o = draft[kind][j], id = `${kind}-${j}`;
  return `<div class="order" id="row-${id}" data-side="${o.side}" role="group" aria-labelledby="name-${id}">
    <div class="order-asset"><span class="asset-mark s${j} ${whole ? 'share' : ''}" aria-hidden="true">${whole ? TICKERS[j] : ''}</span>
      <div><b id="name-${id}">${name}</b><span class="asset-kind">${whole ? `Company shares · linked to ${GOODS[j]}` : `Cargo · from the ${SECTORS[j]}`}</span></div></div>
    <dl class="order-facts"><div><dt>You hold</dt><dd class="num">${units(held)}</dd></div><div><dt>Opening price</dt><dd class="num">${money(quote)}</dd></div></dl>
    <div class="order-controls">
      <div class="seg" role="group" aria-label="${name}: buy, sell or hold">${['buy', 'sell', 'hold'].map(side =>
        `<button type="button" class="seg-btn" id="side-${id}-${side}" data-action="side" data-kind="${kind}" data-j="${j}" data-side="${side}" aria-pressed="${o.side === side}">${cap(side)}</button>`).join('')}</div>
      <div class="qty">${stepper(`qty-${id}`, o.qty, {action: 'step', attrs: `data-field="qty" data-kind="${kind}" data-j="${j}"`, label: `${name} quantity`, mode: whole ? 'numeric' : 'decimal'})}
        ${btn('Max', 'max', {cls: 'btn-sm btn-ghost', id: `max-${id}`, attrs: `data-kind="${kind}" data-j="${j}"`})}</div>
    </div>
    <p class="order-cash" data-live="cash-${id}">No order</p>
    <p class="order-limit hint" id="limit-${id}" data-live="limit-${id}"></p>
    ${fieldError(id, `qty-${id}`)}
  </div>`;
}

function contractHtml(j, readOnly = false) {
  const r = state.rules, y = state.you, done = y.contracts[j], need = r.contract_qty[j];
  return `<div class="contract ${done ? 'done' : ''}">
    <input type="checkbox" id="contract-${j}" data-field="contract" data-j="${j}" ${done ? 'checked disabled' : draft.contracts[j] ? 'checked' : ''} ${readOnly ? 'disabled' : ''}>
    <label for="contract-${j}"><b>${CONTRACTS[j]}</b><span>Deliver ${units(need)} ${GOODS[j]} for <b class="num">+${money(r.contract_score[j])}</b> permanent score (not spendable).</span>
      <span class="hint">${done ? 'Completed. Each contract pays once.' : `You hold ${units(y.inventory[j])} now. Delivery happens after this round’s extraction if you then hold ${units(need)}; the cargo is used up. At opening prices it’s worth ${money(need * state.prices[j])} cr. If you’re short, nothing happens and you can request again later.`}</span></label></div>`;
}

// ---------- phases ----------

function lobbyHtml() {
  const s = state, n = s.players.length;
  return `${pageHead('Lobby', 'Assemble your crews', 'Share the room code with 1–3 other players. The host starts the match once everyone is here.')}
  <section class="block invite" aria-labelledby="invite-title">
    <h2 id="invite-title" class="sr-only">Invite</h2>
    <div class="invite-code"><span class="kicker">Room code</span><b class="code-big">${s.code}</b></div>
    <div class="invite-actions">${btn(`${icon('copy')}Copy code`, 'copy-code', {id: 'copy-code-2'})}${btn(`${icon('link')}Copy invite link`, 'copy-invite', {id: 'copy-invite'})}</div>
    <p class="hint">Invites contain only the room code. Your private rejoin key stays on this device; never share it.</p>
  </section>
  <section class="block" aria-labelledby="seats-title"><h2 id="seats-title">Crews <span class="note">${n} of 4</span></h2>
    <ul class="seats">${[0, 1, 2, 3].map(i => { const p = s.players[i];
      return p ? `<li class="seat">${avatar(p)}<span class="crew-name">${esc(p.name)}${p.seat === s.you.seat ? '<span class="badge">You</span>' : ''}${p.host ? '<span class="badge">Host</span>' : ''}</span><span class="presence ${p.online ? 'on' : 'off'}">${p.online ? 'Online' : 'Offline · seat held'}</span></li>`
        : '<li class="seat vacant"><span class="avatar vacant" aria-hidden="true"></span><span>Open seat</span></li>'; }).join('')}</ul></section>
  <div class="next-step">${s.you.seat === 0
    ? `<div><b>${n < 2 ? 'Waiting for another crew' : 'Ready when you are'}</b><p>${n < 2 ? 'You need at least one more crew to start.' : `${n} crews have joined. New crews can’t join after the start.`}</p></div>${startButton('start-main')}`
    : `<div><b>Waiting for ${nameOf(0)} to start</b><p>The host starts the match once 2–4 crews have joined.</p></div>`}</div>
  <section class="block" aria-labelledby="howto-title"><h2 id="howto-title">How a round works</h2>
    <ol class="round-steps"><li><b>Briefing</b><span>Read demand and hazard odds. Buy optional private scans or fuel.</span></li>
      <li><b>Planning</b><span>Secretly send drones, bid for access, place trades and delivery requests, then lock.</span></li>
      <li><b>Settlement</b><span>Runs the moment the last crew locks: trades, access, hazards, salvage, prices, contracts.</span></li>
      <li><b>Results & refit</b><span>See what happened and why, buy upgrades, then ready up. After six rounds the highest net worth wins.</span></li></ol></section>`;
}

function marketCards() {
  const s = state, n = s.players.length;
  return `<div class="market-cards">${[0, 1, 2].map(j => {
    const level = M.demandLevel(s.demand[j], n, s.rules.demand[j]), series = M.priceSeries(s.history, 'prices', j), last = s.history.at(-1);
    return `<article class="market-card s${j}"><h3>${goodTag(j)}</h3>
      <p class="quote num">${money(s.prices[j])}<small>cr / unit</small></p>
      <p class="since">${last ? `${move(last.opening_prices[j], s.prices[j])} since last round` : 'Starting price'}</p>
      ${sparkline(series)}
      <p class="demand"><b>${level.label}</b> · ${units(s.demand[j])} units wanted (${level.multiplier}× normal)</p></article>`;
  }).join('')}</div>`;
}

function sparkline(series, label = 'Recorded price by round') {
  if (series.length < 2) return '';
  const w = 120, h = 28, lo = Math.min(...series), hi = Math.max(...series), span = hi - lo || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1) * w).toFixed(1)},${(h - 2 - (v - lo) / span * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}: ${series.map(money).join(', ')}"><polyline points="${pts}"/></svg>`;
}

function briefingHtml() {
  const s = state, y = s.you, r = s.rules, cost = y.scanner ? r.upgraded_scan_cost : r.scan_cost;
  const working = y.drones.filter(d => !d.disabled), disabled = y.drones.length - working.length;
  return `${pageHead(`Round ${s.round} of 6 · Briefing`, 'Read the field', 'Check demand and hazard odds, buy optional private scans or fuel, then mark yourself ready. Planning opens when every crew is ready.')}
  <section class="block" aria-labelledby="h-market"><div class="block-head"><h2 id="h-market">What changed</h2>
    <p>Demand is posted for this round. Hazard outcomes and market events are already rolled and sealed on the server.</p></div>
    ${marketCards()}
    <p class="fleet-note">${y.recovery ? `${icon('alert')}No normal mission is affordable, so you have a temporary recovery drone this round (Belt only, protected access, no fuel or deployment cost).`
      : `${drone()}You have ${plural(working.length, 'working drone')}${disabled ? `, ${disabled} disabled (repair at refit)` : ''} and ${y.fuel} fuel.`}</p>
  </section>
  <section class="block" aria-labelledby="h-sectors"><div class="block-head"><h2 id="h-sectors">Sectors</h2>
    <p>Private scans: <b>${y.scans.length} of 2 used</b> · ${money(cost)} cr each${y.scanner ? ' with your scanner' : ''}. A hazard scan shows this round’s actual outcome for that sector, only to you.</p></div>
    ${errorSlot('scan')}
    <div class="sectors">${[0, 1, 2].map(j => sectorHtml(j, 'brief')).join('')}</div></section>
  <section class="block" aria-labelledby="h-events"><div class="block-head"><h2 id="h-events">Market events</h2>
    <p>Each cargo has a sealed event this round: −8% (20% chance), none (60%), or +8% (20%). An event scan reveals it to you.</p></div>
    <ul class="events">${[0, 1, 2].map(j => { const scan = y.scans.find(x => x.target === 'event' && x.sector === j);
      return `<li>${goodTag(j)}${scan ? `<p class="scan-result"><span class="private">${icon('lock')}Your private scan</span><b>${scan.value ? pct(scan.value, 0) : 'No'} event</b></p>`
        : cmdBtn(`Scan event · ${money(cost)} cr`, 'scan', {cls: 'btn-sm', id: `scan-e-${j}`, attrs: `data-target="event" data-sector="${j}"`, off: scanOff('event', j)})}</li>`; }).join('')}</ul></section>
  ${fuelHtml()}
  ${recoveryHtml()}
  <div class="next-step">${y.ready
    ? `<div><b>${icon('check')}You’re ready</b><p>${waitingNote() || 'Opening planning…'} Planning opens when every crew is ready.</p></div>`
    : `<div><b>Done here?</b><p>Scans and fuel purchases close once you’re ready.</p></div>${cmdBtn('Ready for planning', 'ready', {cls: 'btn-primary', id: 'ready-main'})}`}</div>`;
}

function fuelHtml(h = 'h2') {
  const y = state.you, r = state.rules, working = y.drones.filter(d => !d.disabled).length;
  return `<section class="block" aria-labelledby="h-fuel"><div class="block-head"><${h} id="h-fuel">Fuel</${h}>
    <p>Tank <b>${y.fuel} of 16</b>. Each drone sent uses ${r.fuel_use[0]} (Belt), ${r.fuel_use[1]} (Cruiser) or ${r.fuel_use[2]} (Rift)${working ? `; your ${plural(working, 'working drone')} ${working === 1 ? 'needs' : 'need'} ${working * r.fuel_use[0]}–${working * r.fuel_use[2]} fuel this round` : ''}. Fuel costs ${money(r.fuel_cost)} cr a unit and has no resale or score value.</p></div>
    <div class="fuel-buy"><label for="fuel-qty">Units to buy</label>
      ${stepper('fuel-qty', fuelQty, {action: 'fuel-step', attrs: 'data-field="fuel"', label: 'Fuel units to buy', mode: 'numeric'})}
      ${btn('Buy fuel', 'fuel', {cls: '', id: 'buy-fuel', attrs: 'data-cmd'})}</div>
    <p class="field-error" id="err-fuel-qty" hidden></p>${errorSlot('fuel')}</section>`;
}

function recoveryHtml() {
  const y = state.you, r = state.rules;
  if (y.recovery || !y.drones.every(d => d.disabled)) return '';
  return `<section class="block" aria-labelledby="h-recover"><div class="block-head"><h2 id="h-recover">No working drones</h2>
    <p>You can still sell assets in your plan, or restore a drone now if you can also afford a Belt launch afterwards.</p></div>
    <div class="button-row">${y.drones.length ? y.drones.map(d => cmdBtn(`Repair ${droneName(d.id)} · ${money(r.repair_cost)} cr`, 'purchase', {id: `brief-repair-${d.id}`, attrs: `data-item="repair" data-id="${d.id}"`, off: y.ready ? 'Closed: you’re ready.' : ''})).join('')
      : cmdBtn(`Buy a drone · ${money(r.drone_cost)} cr`, 'purchase', {id: 'brief-drone', attrs: 'data-item="drone"', off: y.ready ? 'Closed: you’re ready.' : ''})}</div>${errorSlot('purchase')}</section>`;
}

function planningHtml() {
  const s = state, r = s.rules, n = s.players.length, ex = M.supplyExample(s.demand[0], r.reserve[0] * n, r);
  const expected = [0, 1, 2].map(j => `${SHORT[j]} ${units((r.clear[j] + .5 * r.disruption[j]) * 100)}%`).join(', ');
  return `${pageHead(`Round ${s.round} of 6 · Planning`, 'Make your plan', 'Choose destinations, set orders, review, then lock. Move between sections freely; nothing is final until you lock, and rivals see your plan only after every crew has locked.')}
  <nav class="jump" aria-label="Plan sections"><a href="#sec-dest">1 Destinations</a><a href="#sec-orders">2 Orders</a><a href="#sec-deliveries">3 Deliveries</a><a href="#sec-estimate">4 Estimate</a></nav>
  <div id="plan-form">
  <section id="sec-dest" class="block" aria-labelledby="h-dest"><div class="block-head"><h2 id="h-dest"><span class="step">1</span>Destinations</h2>
    <p>Send each working drone to one sector, or leave it at port. A drone sent costs its fuel and ${money(r.deploy_cost)} cr even if a rival wins access. Idle drones still depreciate.</p></div>
    ${fleetHtml()}
    <div class="sectors">${[0, 1, 2].map(j => sectorHtml(j, 'plan')).join('')}</div>
    ${fieldError('fuel')}</section>
  <section id="sec-orders" class="block" aria-labelledby="h-orders"><div class="block-head"><h2 id="h-orders"><span class="step">2</span>Market orders</h2>
    <p>Trades fill at the opening prices below, before extraction. A buy reserves its price plus ${pct(r.fee, 0).replace('+', '')} fee now. Sale proceeds arrive at settlement and can’t fund this plan. Salvage from this round can be sold next round.</p></div>
    <h3 class="group-title">Cargo</h3><div class="orders">${[0, 1, 2].map(j => orderHtml('cargo', j)).join('')}</div>
    <h3 class="group-title">Company shares</h3><div class="orders">${[0, 1, 2].map(j => orderHtml('shares', j)).join('')}</div>
    ${fieldError('credits')}</section>
  <section id="sec-deliveries" class="block" aria-labelledby="h-del"><div class="block-head"><h2 id="h-del"><span class="step">3</span>Delivery contracts <span class="opt">optional</span></h2>
    <p>Every crew can complete each contract once. A request is part of your sealed plan for this round.</p></div>
    <div class="contracts">${[0, 1, 2].map(j => contractHtml(j)).join('')}</div></section>
  </div>
  <section id="sec-estimate" class="block" aria-labelledby="h-est"><div class="block-head"><h2 id="h-est"><span class="step">4</span>Market estimate</h2>
    <p><b>Estimated under the assumptions shown</b>, not a forecast. Rival plans are sealed and hazards are uncertain.</p></div>
    <div class="estimate"><div id="estimate-body" class="estimate-body"></div>
      <aside class="assumptions" aria-labelledby="h-assume"><h3 id="h-assume">Assumptions</h3>
        <label for="rival">Rival extraction <output id="rival-out" for="rival">${rivalFactor.toFixed(1)}× neutral</output></label>
        <input type="range" id="rival" data-field="rival" min="0" max="2" step="0.1" value="${rivalFactor}">
        <ul><li>Rival crews trade nothing.</li><li>Unscanned market events: 0%.</li><li>Hazards: expected yields (${expected}) unless you scanned.</li><li>Access: shared. Win/lose scenarios appear when you bid.</li></ul></aside></div>
    ${disclosure('supply-example', 'How extraction moves prices', `<p>Each cargo price responds to how much all crews extract against posted demand. This round, Alloy demand is <b>${units(ex.demand)}</b> units and the Belt reserve is <b>${units(ex.reserve)}</b>.</p>
      <p>If crews bring back none, the supply term is <b>${pct(ex.none)}</b>. If they bring back the full reserve, it is <b>${pct(ex.full)}</b>. More salvage than demand pushes the price down; the formula caps this term at ±${pct(r.supply_signal).replace('+', '')}.</p>
      <p>Trading, a pull toward the base price and the sealed event add to it, and the total move is capped at ±25%. Company shares follow their company’s profit instead, so a glut can lift a share while the cargo falls.</p>`)}
  </section>
  <div class="review-cta"><p class="plan-check" data-live="check"></p>${btn(`${icon('lock')}Review plan`, 'review', {cls: 'btn-primary', id: 'review-main'})}</div>`;
}

function renderEstimate() {
  const el = $('#estimate-body');
  if (!el) return;
  const p = preview, status = {loading: '<span class="est-flag">Updating…</span>', paused: '', error: ''}[previewStatus] || '';
  let body = '';
  if (previewStatus === 'paused') body = `<p class="est-note">${icon('info')}Estimate paused until the highlighted order fields are fixed.</p>`;
  else if (previewStatus === 'error') body = `<p class="est-note warn">${icon('alert')}Estimate unavailable: ${esc(previewError)}. Your plan is unaffected.</p>`;
  if (p && previewStatus !== 'paused') {
    body += `<ul class="est-list ${previewStatus === 'loading' ? 'stale' : ''}">${[0, 1, 2].map(j => `<li class="s${j}">${goodTag(j)}
      <span class="est-price num">${money(state.prices[j])} → <b>${money(p.projected_prices[j])}</b> ${move(state.prices[j], p.projected_prices[j])}</span>
      <span class="est-haul">Your haul ≈ <b class="num">${units(p.personal[j])}</b> · worth ≈ <b class="num">${money(p.salvage_value[j])}</b> cr</span>
      <span class="est-total hint">All crews ≈ ${units(p.total_supply[j])} of ${units(state.demand[j])} demanded</span></li>`).join('')}</ul>
      ${p.scenarios && evaluation().plan.bids.some(b => b > 0) ? `<div class="scenarios"><h3>If your bids win or lose</h3>${p.scenarios.slice(1).map(sc => `<p><b>${sc.mode === 'access_won' ? 'You win every positive bid' : 'You lose every positive bid'}:</b> haul ${sc.personal.map(units).join(' / ')} units (Alloys / Cores / Relics), worth ≈ ${money(M.sum(sc.salvage_value))} cr.</p>`).join('')}<p class="hint">Illustrative outcomes, not probabilities.</p></div>` : ''}
      ${p.error && !M.evaluate(draft, ctx()).valid ? '' : p.error ? `<p class="est-note warn">${icon('alert')}Server check: ${esc(friendly(p.error))}</p>` : ''}`;
  }
  if (!p && !body) body = '<p class="est-note">Calculating…</p>';
  el.innerHTML = `${status}${body}`;
}

function planSummaryHtml(ev, {review = false} = {}) {
  const t = ev.totals, plan = ev.plan, r = state.rules;
  const dest = [0, 1, 2].map(j => { const ids = Object.keys(plan.allocation).filter(id => plan.allocation[id] === j);
    return ids.length ? `<li><b>${SECTORS[j]}:</b> ${ids.map(droneName).join(', ')}${plan.bids[j] ? ` · bid ${plan.bids[j]} cr` : ' · no bid'}</li>` : ''; }).join('');
  const idle = M.fleetFor(state.you).filter(d => !d.disabled && plan.allocation[d.id] === undefined).map(d => droneName(d.id));
  const orders = ev.lines.map(l => `<li><b>${cap(l.side)} ${l.kind === 'shares' ? plural(l.qty, 'share') : plural(l.qty, 'unit')}</b> ${l.kind === 'shares' ? `of ${COMPANIES[l.j]}` : `of ${GOODS[l.j]}`} at ${money(l.price)} · <span class="num">${signedMoney(l.cash)} cr</span>${l.side === 'sell' ? ' after settlement' : ''} <span class="hint">(fee ${money(l.fee)})</span></li>`).join('');
  const deliveries = plan.contracts.map((c, j) => c ? `<li>${CONTRACTS[j]}: ${units(r.contract_qty[j])} ${GOODS[j]} → +${money(r.contract_score[j])} score</li>` : '').join('');
  return `<div class="summary">
    <section><h3>Destinations</h3><ul>${dest || '<li>No drones sent.</li>'}${idle.length ? `<li class="hint">At port: ${idle.join(', ')}</li>` : ''}</ul></section>
    <section><h3>Orders</h3><ul>${orders || '<li>No trades.</li>'}</ul></section>
    <section><h3>Delivery requests</h3><ul>${deliveries || '<li>None.</li>'}</ul></section>
    <section class="money"><h3>${review ? 'Reserved when you lock' : 'Reserved'}</h3><dl>
      <div><dt>Deployment</dt><dd class="num">${money(t.deployment)}</dd></div>
      <div><dt>Access bids <span class="hint">returned if you lose</span></dt><dd class="num">${money(t.bids)}</dd></div>
      <div><dt>Buys, incl. fees</dt><dd class="num">${money(t.buys)}</dd></div>
      <div class="sum"><dt>Total reserved</dt><dd class="num">${money(t.reserved)} of ${money(state.you.credits)}</dd></div>
      <div><dt>Credits left</dt><dd class="num">${money(t.available)}</dd></div>
      <div><dt>Fuel</dt><dd class="num">${t.fuel} of ${t.tank}</dd></div>
      ${t.sells ? `<div><dt>Sale proceeds <span class="hint">arrive after settlement; not counted above</span></dt><dd class="num">+${money(t.sells)}</dd></div>` : ''}</dl></section></div>`;
}

const ERROR_LABEL = k => k === 'fuel' ? 'Fuel' : k === 'credits' ? 'Credits' : k.startsWith('bid-') ? `${SECTORS[k.at(-1)]} bid`
  : `${k.startsWith('cargo') ? GOODS[k.at(-1)] : `${COMPANIES[k.at(-1)]} shares`}`;
const ERROR_TARGET = k => k === 'fuel' ? 'sec-dest' : k === 'credits' ? 'sec-orders' : k.startsWith('bid-') ? k : `qty-${k}`;

function reviewDialog() {
  const ev = evaluation(), s = state;
  modal(`Review your round ${s.round} plan`, `${planSummaryHtml(ev, {review: true})}
    ${ev.valid ? '' : `<section class="issues" role="alert"><h3>${icon('alert')}Fix before locking</h3><ul>${Object.entries(ev.errors).map(([k, v]) =>
      `<li>${btn(ERROR_LABEL(k), 'goto', {cls: 'btn-link', attrs: `data-target="${ERROR_TARGET(k)}"`})}: ${esc(v)}</li>`).join('')}</ul></section>`}
    <div class="dialog-actions">${btn('Keep editing', 'close-dialog', {id: 'keep-editing'})}
      ${btn(`${icon('lock')}Lock plan for round ${s.round}`, 'lock', {cls: 'btn-primary', id: 'lock-plan', attrs: `data-cmd ${ev.valid ? '' : 'data-off disabled'}`})}</div>
    <p class="hint">Locking is final for this round: you can’t edit afterwards. Other crews see your plan only after every crew has locked.</p>`, {sheet: true});
}

function lockedHtml() {
  const ev = M.evaluate(M.draftFromPlan(state.you.plan), ctx());
  return `${pageHead(`Round ${state.round} of 6 · Planning`, 'Plan locked', '')}
  <div class="next-step locked"><div><b>${icon('lock')}Your plan is sealed</b><p>${waitingNote() || 'Every crew has locked; settling now.'} Settlement runs automatically the moment the last crew locks. There’s no timer: if a crew is offline, the room waits for them to return.</p></div></div>
  <section class="block" aria-labelledby="h-yourplan"><h2 id="h-yourplan">Your locked plan</h2>${planSummaryHtml(ev)}</section>`;
}

// ---------- reveal ----------

function startSequenceIfNew() {
  if (!['upgrade', 'finished'].includes(state.phase)) return;
  const round = state.history.at(-1)?.round, key = `sx-seen-${state.code}-${state.you.seat}-${round}`;
  clearTimeout(seq.timer);
  if (read(key) || reduceMotion()) { seq = {round, playing: false, timer: 0}; return; }
  save(key, true);
  seq = {round, playing: true, timer: setTimeout(() => endSequence(), 3700)};
}
function endSequence() { seq.playing = false; clearTimeout(seq.timer); $('.seq-live')?.classList.remove('playing'); setNote(''); }
function setNote(text) { const n = $('#seq-note'); if (n) n.textContent = text; }

function sectorStory(log, report, j) {
  const seat = state.you.seat, plans = log.plans, mine = Object.entries(plans[seat].allocation).filter(([, s]) => s === j).map(([d]) => d);
  const crews = plans.filter(p => Object.values(p.allocation).includes(j)).length, winner = log.access[j];
  const bids = log.bids.map((b, i) => ({i, b: b[j]})).filter(x => x.b > 0);
  const access = winner === null ? (crews ? (crews > 1 ? `Shared by ${crews} crews; no bids` : 'One crew; no bids') : 'Nobody went')
    : `${nameOf(winner)} won exclusive access for ${log.bids[winner][j]} cr${bids.length > 1 ? ` (${bids.length} bids)` : ''}`;
  let you = '';
  if (mine.includes('-1')) you = 'Your recovery drone had protected access.';
  else if (mine.length) {
    const myBid = log.bids[seat][j];
    if (winner === seat) you = `You won with ${myBid} cr.`;
    else if (winner !== null && myBid) you = `Your ${myBid} cr bid lost; it was returned. Your ${plural(mine.length, 'drone')} still used fuel and deployment.`;
    else if (winner !== null) you = `Your ${plural(mine.length, 'drone')} were turned away; fuel and deployment were still spent.`;
    else you = crews > 1 ? `You shared it with ${crews - 1} other ${crews === 2 ? 'crew' : 'crews'} by drone capacity.` : 'You had it to yourself.';
  }
  return {mine, crews, access, you};
}

function roundHtml(log, report, live) {
  if (!log) return '';
  const s = state, seat = s.you.seat, r = s.rules, n = s.players.length, playing = live && seq.playing && seq.round === log.round;
  const pubDelta = log.deltas[seat];
  const objDelta = report ? report.after.objective - report.before.objective : null;
  const stories = [0, 1, 2].map(j => sectorStory(log, report, j));
  const highlights = [];
  stories.forEach((st, j) => { if (st.mine.length && st.crews > 1) highlights.push(`${SECTORS[j]} was contested by ${st.crews} crews`); });
  if (log.access.includes(seat)) highlights.push(`You won access to the ${list(log.access.map((a, j) => a === seat ? SECTORS[j] : null).filter(Boolean))}`);
  (report?.hits || []).forEach(h => highlights.push(`${droneName(h.drone)} ${h.repaired ? 'was hit and repaired by insurance' : 'was disabled'}`));
  (report?.contracts || []).forEach(j => highlights.push(`${CONTRACTS[j]} delivered`));
  const step = (i, title, body) => `<li class="seq-step d${i}"><h3><span class="step">${i + 1}</span>${title}</h3>${body}</li>`;

  const trades = report ? report.trades : [];
  const tradeBody = `${trades.length ? `<ul class="facts-list">${trades.map(t => `<li>${t.quantity > 0 ? 'Bought' : 'Sold'} ${t.kind === 'shares' ? plural(Math.abs(t.quantity), `${COMPANIES[t.asset]} share`) : `${plural(Math.abs(t.quantity), 'unit')} of ${GOODS[t.asset]}`} at ${money(t.price)} <span class="num">${signedMoney(t.cash)} cr</span> <span class="hint">incl. ${money(t.fee)} fee</span></li>`).join('')}</ul>`
    : `<p>${report ? 'You placed no trades.' : 'Your trade details for this round aren’t recorded on this server.'}</p>`}
    <p class="hint">All crews’ net orders: cargo ${log.netcargo.map((q, j) => `${GOODS[j]} ${q > 0 ? '+' : ''}${units(q)}`).join(', ')}; shares ${log.netstock.map((q, j) => `${TICKERS[j]} ${q > 0 ? '+' : ''}${q}`).join(', ')}.</p>`;

  const accessBody = `<ul class="sector-results">${stories.map((st, j) => `<li class="s${j}"><span class="sr-art">${art(j)}</span><div><b>${SECTORS[j]}</b><span>${st.access}</span>${st.you ? `<span class="you">${st.you}</span>` : ''}</div></li>`).join('')}</ul>`;

  const hazardBody = `<ul class="sector-results">${[0, 1, 2].map(j => { const h = M.hazardResult(log.hazards[j]), mine = log.gains[seat][j];
    return `<li class="s${j}"><span class="sr-art">${art(j)}</span><div><b>${SECTORS[j]} <span class="hz tone-${h.tone}">${h.label}</span></b><span>${h.effect[0].toUpperCase() + h.effect.slice(1)}. Crews recovered ${units(log.extraction[j])} of ${units(r.reserve[j] * n)} ${GOODS[j]}.</span>${stories[j].mine.length ? `<span class="you">You recovered ${units(mine)}.</span>` : ''}</div></li>`; }).join('')}</ul>
    ${(report?.hits || []).map(h => `<p class="${h.repaired ? 'ok' : 'warn-text'}">${icon(h.repaired ? 'check' : 'alert')}${droneName(h.drone)} was disabled in the ${SECTORS[h.sector]}${h.repaired ? ' and repaired automatically by insurance.' : `. Repair it at refit for ${money(r.repair_cost)} cr; until then it counts 25% of book value.`}</p>`).join('')}`;

  const marketBody = `<ul class="moves">${[0, 1, 2].map(j => { const d = M.drivers(log.commodity_terms[j], M.COMMODITY_TERMS);
    return `<li>${goodTag(j)}<span class="num">${money(log.opening_prices[j])} → <b>${money(log.prices[j])}</b></span>${move(log.opening_prices[j], log.prices[j])}<span class="why-move">${d.summary}${log.commodity_audit?.[j]?.return_clipped ? '; capped at ±25%' : ''}${log.commodity_audit?.[j]?.quote_clipped ? '; held at a price limit' : ''}. Extracted ${units(log.extraction[j])} vs demand ${units(log.demand[j])}.</span></li>`; }).join('')}
    ${[0, 1, 2].map(j => { const d = M.drivers(log.stock_terms[j].components, M.STOCK_TERMS);
    return `<li><span class="good share">${TICKERS[j]} ${COMPANIES[j]}</span><span class="num">${money(log.opening_stocks[j])} → <b>${money(log.stocks[j])}</b></span>${move(log.opening_stocks[j], log.stocks[j])}<span class="why-move">${d.summary}${log.stock_audit?.[j]?.return_clipped ? '; capped at ±25%' : ''}.</span></li>`; }).join('')}</ul>`;

  const insured = (report?.hits || []).filter(h => h.repaired);
  const upkeepBody = report ? `<ul class="facts-list">
      ${report.contracts.length ? report.contracts.map(j => `<li>${icon('check')}${CONTRACTS[j]} delivered: −${units(r.contract_qty[j])} ${GOODS[j]}, <b>+${money(r.contract_score[j])}</b> permanent score.</li>`).join('') : '<li>No contracts completed this round.</li>'}
      ${insured.length ? insured.map(h => `<li>${icon('check')}Insurance repaired ${droneName(h.drone)}.</li>`).join('') : ''}
      <li>Fleet depreciation: <span class="num">${signedMoney(-report.depreciation)}</span> (every drone loses ${pct(r.depreciation, 0).replace('+', '')} book value per round).</li>
      ${cents(report.disabling) ? `<li>Disabled drones now count 25% of book value: <span class="num">${signedMoney(report.disabling)}</span>.</li>` : ''}</ul>`
    : '<p>Contract, insurance and depreciation details for your crew aren’t recorded for this round.</p>';

  let scoreBody;
  if (report) {
    const rec = M.reconcile(report.before, report.after, M.PUBLIC_KEYS, pubDelta);
    const note = {credits: `trades ${signedMoney(report.trade_cash)} · deployment ${signedMoney(-report.deployment)}${report.bid_paid ? ` · access bid ${signedMoney(-report.bid_paid)}` : ''}`,
      fleet: `depreciation ${signedMoney(-report.depreciation)}${cents(report.disabling) ? ` · disabled ${signedMoney(report.disabling)}` : ''}`,
      salvage: 'trades, salvage, deliveries and new prices', stocks: 'trades and new share prices', contracts: 'completed deliveries'};
    scoreBody = `<table class="recon"><caption class="sr-only">Your change by component</caption><thead><tr><th scope="col">Component</th><th scope="col" class="num">Before</th><th scope="col" class="num">After</th><th scope="col" class="num">Change</th></tr></thead><tbody>
      ${rec.parts.map(p => `<tr><th scope="row">${COMPONENTS.find(c => c[0] === p.key)[1]}<span class="hint">${note[p.key]}</span></th><td class="num">${money(p.before)}</td><td class="num">${money(p.after)}</td><td class="num">${delta(p.delta)}</td></tr>`).join('')}
      ${cents(rec.rounding) ? `<tr><th scope="row">Rounding<span class="hint">cent rounding in settlement</span></th><td></td><td></td><td class="num">${delta(rec.rounding)}</td></tr>` : ''}
      <tr class="sum"><th scope="row">Public change<span class="hint">what every crew sees</span></th><td class="num">${money(M.sum(M.PUBLIC_KEYS.map(k => report.before[k])))}</td><td class="num">${money(M.sum(M.PUBLIC_KEYS.map(k => report.after[k])))}</td><td class="num">${delta(pubDelta)}</td></tr>
      <tr class="private"><th scope="row">Objective<span class="hint">private until the end</span></th><td class="num">${money(report.before.objective)}</td><td class="num">${money(report.after.objective)}</td><td class="num">${delta(objDelta)}</td></tr>
      <tr class="sum"><th scope="row">Your net worth</th><td class="num">${money(total(report.before))}</td><td class="num">${money(total(report.after))}</td><td class="num">${delta(total(report.after) - total(report.before))}</td></tr></tbody></table>
      <p class="hint">“Before” is your position when the last plan locked, after briefing purchases.</p>`;
  } else scoreBody = `<p>Your public change: ${delta(pubDelta)} cr.</p>`;
  scoreBody += `<p class="hint">All crews’ public change: ${s.players.map((p, i) => `${esc(p.name)} ${signedMoney(log.deltas[i])}`).join(' · ')}.</p>`;

  const headline = `<div class="headline ${tone(pubDelta)}"><p class="kicker">Your result</p>
    <p class="big num">${signedMoney(pubDelta)}<small>cr public value</small></p>
    ${report ? `<p>${cents(objDelta) ? `Private objective ${signedMoney(objDelta)} cr. ` : ''}Net worth now ${money(total(report.after))} cr${live ? ' after settlement' : ''}, including your objective.</p>` : ''}
    ${highlights.length ? `<ul class="highlights">${highlights.slice(0, 4).map(h => `<li>${h}</li>`).join('')}</ul>` : ''}</div>`;

  return `<section class="block reveal" aria-labelledby="h-round-${log.round}${live ? '-live' : ''}">
    <div class="reveal-head"><div><p class="kicker">Settled · round ${log.round} of 6</p><h2 id="h-round-${log.round}${live ? '-live' : ''}">${live ? 'What happened this round' : `Round ${log.round}`}</h2></div>
      ${live ? `<div class="seq-controls">${btn(`${icon('skip')}Skip`, 'seq-skip', {cls: 'btn-sm', id: 'seq-skip'})}${btn(`${icon('replay')}Replay`, 'seq-replay', {cls: 'btn-sm', id: 'seq-replay'})}</div>` : ''}</div>
    ${live ? `<p class="seq-note hint" id="seq-note" aria-live="polite">${playing ? 'Playing back the settlement that already ran.' : ''}</p>` : ''}
    <div class="seq ${live ? 'seq-live' : ''} ${playing ? 'playing' : ''}">
      ${headline}
      <ol class="seq-steps">${step(0, 'Trades at opening prices', tradeBody)}${step(1, 'Who got access', accessBody)}${step(2, 'Hazards and salvage', hazardBody)}
        ${step(3, 'Market repricing', marketBody)}${step(4, 'Contracts, insurance and depreciation', upkeepBody)}${step(5, 'Your score', scoreBody)}</ol>
    </div>
    ${roundDetails(log)}</section>`;
}

function roundDetails(log) {
  const s = state, r = s.rules;
  const crewTable = `<div class="audit-scroll" role="region" aria-label="All crews table, scrolls sideways" tabindex="0"><table><thead><tr><th scope="col">Crew</th><th scope="col">Drones sent</th><th scope="col">Bids (Belt / Cruiser / Rift)</th><th scope="col">Haul (Alloys / Cores / Relics)</th><th scope="col" class="num">Public change</th></tr></thead><tbody>
    ${s.players.map((p, i) => `<tr><th scope="row">${esc(p.name)}</th><td>${Object.entries(log.plans[i].allocation).map(([d, sct]) => `${droneName(d)} → ${SHORT[sct]}`).join(', ') || 'None'}</td><td class="num">${log.bids[i].join(' / ')}</td><td class="num">${log.gains[i].map(units).join(' / ')}</td><td class="num">${delta(log.deltas[i])}</td></tr>`).join('')}</tbody></table></div>`;
  const plans = log.plans.map((p, i) => `<p><b>${nameOf(i)}</b>: cargo orders ${p.commodity_orders.map((q, j) => `${GOODS[j]} ${q > 0 ? '+' : ''}${units(q)}`).join(', ')}; share orders ${p.stock_orders.map((q, j) => `${TICKERS[j]} ${q > 0 ? '+' : ''}${q}`).join(', ')}; deliveries requested: ${p.contracts.map((c, j) => c ? CONTRACTS[j] : null).filter(Boolean).join(', ') || 'none'}.</p>`).join('');
  const formulas = [0, 1, 2].map(j => { const t = log.commodity_terms[j], st = log.stock_terms[j], raw = M.sum(t), sraw = M.sum(st.components);
    const buys = M.sum(log.plans.map(p => Math.max(0, p.commodity_orders[j]))), sells = M.sum(log.plans.map(p => Math.max(0, -p.commodity_orders[j])));
    return `<h4>${GOODS[j]} ${money(log.opening_prices[j])} → ${money(log.prices[j])}</h4>
      <p class="formula">Demand D = ${units(log.demand[j])}; extraction Q = ${units(log.extraction[j])}; buys B = ${units(buys)}; sells S = ${units(sells)}<br>
      Supply: ${r.supply_signal} × clamp((D − Q) / D, −1, 1) = ${pct(t[0], 2)}<br>Trading: ${r.trade_signal} × clamp((B − S) / D, −1, 1) = ${pct(t[1], 2)}<br>
      Base pull: ${r.commodity_pull} × (${r.base[j]} / ${money(log.opening_prices[j])} − 1) = ${pct(t[2], 2)}<br>Event = ${pct(t[3], 2)}<br>
      Raw ${pct(raw, 2)} → capped ${pct(Math.max(-.25, Math.min(.25, raw)), 2)} → quote ${money(log.prices[j])} (limits ${money(r.base[j] / 4)}–${money(r.base[j] * 4)})</p>
      <h4>${COMPANIES[j]} ${money(log.opening_stocks[j])} → ${money(log.stocks[j])}</h4>
      <p class="formula">Output per crew O = ${r.demand[j]} + ${r.company_output_link} × ${units(log.extraction[j])} / ${s.players.length} = ${units(st.output)}<br>
      Profit = O × (${money(log.prices[j])} − ${r.company_cost[j]}) − ${r.company_fixed[j]} = ${money(st.profit)}; baseline ${money(st.baseline)}<br>
      Profit signal ${pct(st.components[0], 2)} · share orders (net ${log.netstock[j]}) ${pct(st.components[1], 2)} · base pull ${pct(st.components[2], 2)}<br>
      Raw ${pct(sraw, 2)} → capped ${pct(Math.max(-.25, Math.min(.25, sraw)), 2)} → ${money(log.stocks[j])} (limits 25.00–400.00)</p>`; }).join('');
  const audit = log.commodity_audit ? `<p class="hint">Effective bounds combine absolute limits with the ±25% bounds rounded inward to the cent. Every value comes from the server record.</p>
    <div class="audit-scroll" role="region" aria-label="Rounding table, scrolls sideways" tabindex="0"><table><thead><tr><th scope="col">Asset</th><th scope="col" class="num">Raw return</th><th scope="col" class="num">Capped</th><th scope="col" class="num">Rounded quote</th><th scope="col" class="num">Bounds</th><th scope="col" class="num">Final</th></tr></thead><tbody>
    ${[...log.commodity_audit, ...log.stock_audit].map((a, i) => `<tr><th scope="row">${[...GOODS, ...COMPANIES][i]}</th><td class="num">${pct(a.raw_return, 2)}</td><td class="num">${pct(a.capped_return, 2)}${a.return_clipped ? ' (capped)' : ''}</td><td class="num">${money(a.rounded_quote)}</td><td class="num">${money(a.lower)}–${money(a.upper)}</td><td class="num">${money(a.price)}${a.quote_clipped ? ' (bound)' : ''}</td></tr>`).join('')}</tbody></table></div>` : '';
  const k = `r${log.round}`;
  return `<div class="details-group">${disclosure(`${k}-crews`, 'All crews this round', crewTable)}${disclosure(`${k}-plans`, 'Revealed orders and deliveries', plans)}
    ${disclosure(`${k}-formulas`, 'Why prices moved: formulas', formulas)}${audit ? disclosure(`${k}-audit`, 'Rounding and price limits', audit) : ''}</div>`;
}

function refitHtml() {
  const s = state, y = s.you, r = s.rules, next = s.round + 1;
  const off = (cond, why) => cond ? why : '';
  const closed = y.ready ? 'Closed: you’re marked ready.' : '';
  return `<section class="block refit" aria-labelledby="h-refit"><div class="block-head"><h2 id="h-refit">Refit for round ${next}</h2>
    <p>Purchases are confirmed by the server and take effect next round. You have <b class="num">${money(y.credits)} cr</b> to spend.</p></div>
    ${errorSlot('purchase')}
    <div class="shop">
      <article class="shop-item"><h3>Basic drone</h3><p>Adds a drone from round ${next}. Fleet ${y.drones.length} of ${r.fleet_limit}. It starts at ${money(r.drone_cost)} book value and loses ${pct(r.depreciation, 0).replace('+', '')} per round.</p>
        ${cmdBtn(`Buy drone · ${money(r.drone_cost)} cr`, 'purchase', {id: 'buy-drone', attrs: 'data-item="drone"', off: closed || off(y.drones.length >= r.fleet_limit, 'Fleet is full (5).') || off(y.credits < r.drone_cost, `Needs ${money(r.drone_cost)} cr.`)})}</article>
      <article class="shop-item"><h3>Scanner</h3><p>Future scans cost ${money(r.upgraded_scan_cost)} cr instead of ${money(r.scan_cost)}. Still two per round. No score value.</p>
        ${y.scanner ? `<p class="ok">${icon('check')}Installed</p>` : cmdBtn(`Buy scanner · ${money(r.scanner_cost)} cr`, 'purchase', {id: 'buy-scanner', attrs: 'data-item="scanner"', off: closed || off(y.credits < r.scanner_cost, `Needs ${money(r.scanner_cost)} cr.`)})}</article>
    </div>
    <h3 class="group-title">Your fleet</h3>
    <ul class="refit-fleet">${y.drones.map(d => `<li>${drone()}<div class="rf-info"><b>${droneName(d.id)}</b>
        <span>${d.disabled ? 'Disabled · counts 25% of book value until repaired' : d.insured ? 'Working · insured for next round' : 'Working'} · ${money(d.value)} book value</span></div>
      <div class="rf-actions">${d.disabled
        ? cmdBtn(`Repair · ${money(r.repair_cost)} cr`, 'purchase', {cls: 'btn-sm', id: `repair-${d.id}`, attrs: `data-item="repair" data-id="${d.id}"`, off: closed || off(y.credits < r.repair_cost, 'Not enough credits.')})
        : d.insured ? `<span class="ok">${icon('check')}Insured</span>` : cmdBtn(`Insure · ${money(r.insurance_cost)} cr`, 'purchase', {cls: 'btn-sm', id: `insure-${d.id}`, attrs: `data-item="insurance" data-id="${d.id}"`, off: closed || off(y.credits < r.insurance_cost, 'Not enough credits.')})}
        ${btn('Retire…', 'retire', {cls: 'btn-sm btn-ghost', id: `retire-${d.id}`, attrs: `data-id="${d.id}" ${y.ready || busy ? 'disabled' : ''}`})}</div></li>`).join('') || '<li>No drones. A recovery drone is offered at briefing if you can’t afford a mission.</li>'}</ul>
    <p class="hint">Insurance (${money(r.insurance_cost)} cr) covers the named drone for next round only: if a severe hazard disables it, it’s repaired automatically after settlement. There’s no cash payout. Retiring pays nothing.</p>
    ${fuelHtml('h3')}</section>
  <div class="next-step">${y.ready
    ? `<div><b>${icon('check')}Refit ready</b><p>${waitingNote() || 'Starting the next round…'}</p></div>`
    : `<div><b>Done refitting?</b><p>Every crew must be ready before round ${next} begins.</p></div>${cmdBtn(`Ready for round ${next}`, 'ready', {cls: 'btn-primary', id: 'ready-main'})}`}</div>`;
}

function finalHtml() {
  const s = state, ranks = M.ranked(s.players), winners = ranks.filter(p => p.rank === 1), second = ranks.find(p => p.rank > 1);
  const title = winners.length > 1 ? `Shared victory: ${list(winners.map(p => esc(p.name)))}` : `${esc(winners[0].name)} wins`;
  const lede = winners.length > 1 ? `Tied at ${money(winners[0].networth)} cr. Exact ties share the win.`
    : `Final net worth ${money(winners[0].networth)} cr${second ? `, ${money(winners[0].networth - second.networth)} cr ahead of ${esc(second.name)}` : ''}.`;
  return `${pageHead('Match complete · after round 6', title, `${lede} Final scores include every crew’s objective, now revealed. Shares and cargo are marked to final prices without a sale fee.`)}
  <section class="block" aria-labelledby="h-final"><h2 id="h-final">Final standings</h2>
    <ol class="final-list">${ranks.map(p => `<li class="${p.seat === s.you.seat ? 'me' : ''}"><div class="fl-head"><span class="rank" aria-label="Rank ${p.rank}">${p.rank}</span>${avatar(p)}
      <div class="fl-who"><b>${esc(p.name)}${p.seat === s.you.seat ? ' <span class="badge">You</span>' : ''}</b><span>${esc(p.objective)} · objective ${money(p.breakdown.objective)}</span></div><b class="num fl-total">${money(p.networth)}</b></div>
      <dl class="fl-comp">${COMPONENTS.map(([k, l]) => `<div><dt>${l}</dt><dd class="num">${money(p.breakdown[k])}</dd></div>`).join('')}</dl></li>`).join('')}</ol></section>
  <section class="block" aria-labelledby="h-journey"><h2 id="h-journey">How the match unfolded</h2>
    <p class="hint">Public value after each round, from the recorded reveals. These exclude objectives, which count only in the final scores above.</p>
    ${historyChart()}
    ${disclosure('final-table', 'Round-by-round values', historyTable())}</section>
  <div class="next-step"><div><b>Play again?</b><p>Start or join a new room from the start screen. There are no upgrades after round 6.</p></div>${btn('Back to start screen', 'home', {cls: 'btn-primary', id: 'new-game'})}</div>`;
}

const publicAfter = (log, i) => M.sum(Object.values(log.scores[i]));

// Charts are drawn at roughly their display width so labels stay legible on phones.
const narrow = () => innerWidth < 640;

function historyChart() {
  const s = state, h = s.history;
  if (!h.length) return '';
  const [W, H, L, R, T, B] = narrow() ? [340, 220, 44, 88, 12, 28] : [640, 240, 64, 120, 16, 28];
  const values = h.flatMap((log, r) => s.players.map((_, i) => publicAfter(log, i)));
  let lo = Math.min(...values), hi = Math.max(...values);
  if (hi - lo < 1) { lo -= 50; hi += 50; }
  const x = r => L + (h.length === 1 ? (W - L - R) / 2 : r / (h.length - 1) * (W - L - R));
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [lo, (lo + hi) / 2, hi];
  const dashes = ['', '6 4', '2 4', '10 4 2 4'];
  // End labels are nudged apart so close finishes stay readable.
  const ends = s.players.map((p, i) => ({i, y: y(publicAfter(h.at(-1), i))})).sort((a, b) => a.y - b.y);
  ends.forEach((e, k) => { if (k) e.y = Math.max(e.y, ends[k - 1].y + 15); });
  const labelY = Object.fromEntries(ends.map(e => [e.i, e.y]));
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Public value by round for each crew; exact values are in the table below">
    ${ticks.map(v => `<g class="tick"><line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v).toLocaleString('en-US')}</text></g>`).join('')}
    ${h.map((log, r) => `<text class="xlab" x="${x(r)}" y="${H - 8}" text-anchor="middle">R${log.round}</text>`).join('')}
    ${s.players.map((p, i) => { const pts = h.map((log, r) => `${x(r).toFixed(1)},${y(publicAfter(log, i)).toFixed(1)}`).join(' '), me = p.seat === s.you.seat, lastY = labelY[i];
      return `<g class="series ${me ? 'me' : ''}"><polyline points="${pts}" stroke-dasharray="${me ? '' : dashes[i % 4]}"/>${h.map((log, r) => `<circle cx="${x(r)}" cy="${y(publicAfter(log, i))}" r="3"/>`).join('')}<text x="${W - R + 8}" y="${lastY + 4}">${esc(p.name.slice(0, 14))}</text></g>`; }).join('')}</svg>`;
}

function historyTable() {
  const s = state;
  return `<div class="audit-scroll" role="region" aria-label="Round values table, scrolls sideways" tabindex="0"><table><thead><tr><th scope="col">Round</th>${s.players.map(p => `<th scope="col" class="num">${esc(p.name)}</th>`).join('')}</tr></thead><tbody>
    ${s.history.map(log => `<tr><th scope="row">${log.round}</th>${s.players.map((_, i) => `<td class="num">${money(publicAfter(log, i))} <span class="hint">${signedMoney(log.deltas[i])}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function ledgerHtml() {
  const s = state;
  if (!s.history.length) return `${pageHead('Ledger', 'No rounds settled yet', '')}
    <section class="block empty-state"><p>Each round’s public results appear here after settlement: where crews went, what came back and why prices moved. Current plans, scans and objectives stay private.</p>${btn('Back to operations', 'view', {cls: 'btn-primary', id: 'ledger-back', attrs: 'data-view="ops"'})}</section>`;
  const reports = s.you.reports || [];
  return `${pageHead('Ledger', 'Round history', 'Every settled round, newest first. Public results for all crews, plus your own private accounting.')}
  <section class="block" aria-labelledby="h-prices"><h2 id="h-prices">Prices by round</h2><p class="hint">Recorded quotes only: round 1’s opening price, then each settled price.</p>
    <ul class="price-history">${[...GOODS.map((g, j) => [g, 'prices', j]), ...COMPANIES.map((c, j) => [c, 'stocks', j])].map(([name, key, j]) => { const series = M.priceSeries(s.history, key, j);
      return `<li><span class="${key === 'prices' ? `good s${j}` : 'good share'}">${key === 'prices' ? '<i aria-hidden="true"></i>' : ''}${name}</span>${sparkline(series, `${name} recorded price by round`)}<span class="num">${money(series[0])} → <b>${money(series.at(-1))}</b></span></li>`; }).join('')}</ul></section>
  ${[...s.history].reverse().map(log => disclosure(`ledger-${log.round}`, `<span class="ledger-sum"><b>Round ${log.round}</b><span>Your public change ${signedMoney(log.deltas[s.you.seat])} cr</span></span>`,
    roundHtml(log, reports.find(r => r.round === log.round), false), 'ledger-round')).join('')}`;
}

// ---------- dialogs ----------

function modal(title, html, {sheet = false} = {}) {
  const d = $('#dialog');
  if (!d.open) dialogReturn = document.activeElement?.id || null;
  $('#dialog-content').innerHTML = `<h2 id="dialog-title">${title}</h2>${html}`;
  d.classList.toggle('sheet', sheet);
  if (!d.open) d.showModal();
}

function help() {
  modal('How to play', `<p class="lede">Crack the wreck. Play the market. Finish round 6 with the highest net worth.</p>
    <h3>A round</h3><ol class="help-steps"><li><b>Briefing.</b> Read demand and hazard odds. Buy fuel and up to two private scans. Everyone marks ready.</li>
      <li><b>Planning.</b> Secretly send drones, bid for access, place buy and sell orders and request deliveries. Then lock; locking is final for the round.</li>
      <li><b>Settlement.</b> Runs the moment the last crew locks: opening-price trades, access, hazards and salvage, cargo prices, share prices, contracts, insurance and depreciation.</li>
      <li><b>Results and refit.</b> See what happened and why, buy drones, a scanner, repairs, insurance or fuel, then mark ready.</li></ol>
    <h3>Net worth</h3><p>Credits + shares + cargo + contract score + depreciated fleet + private objective bonus (up to 120). Only credits are spendable. Contracts add permanent score, not cash. Public standings leave out every crew’s objective until the end. Exact ties share the win.</p>
    <h3>Access and hazards</h3><p>With no bids, crews in a sector share its finite reserve in proportion to drones sent. The highest positive bid takes the sector alone and pays; ties are random; losing bids are returned. Drones turned away still use fuel and deployment. Clear gives full yield, disruption half, severe nothing and disables the lowest-numbered drone of each crew working there. Repairs cost 30 cr; 12 cr insurance repairs its named drone automatically after next round’s settlement.</p>
    <h3>Trading</h3><p>Orders fill at the opening prices with a 2% fee, before extraction. Buys must be affordable without sale proceeds or returned bids. You can’t sell what you don’t hold, including this round’s salvage. Limits: Alloys 4, Power Cores 2, Relic Tech 1 and shares 2 per round; holdings up to 20 / 12 / 8 cargo and 6 shares per company. No short selling or loans.</p>
    <h3>Prices</h3><p>Cargo prices move with supply against demand, crew trading, a pull toward the base price and a sealed event. Share prices follow their company’s profit, share orders and a pull toward 100. Every move is capped at ±25%.</p>
    <h3>Privacy</h3><p>The server holds plans, bids, hazards and events. Scans belong to the crew that paid. Plans become public after everyone locks; objectives at the end. Keep your rejoin key private.</p>
    <h3>Recovery</h3><p>If no normal mission is affordable, you get a temporary protected drone for the Belt with no fuel or deployment cost and no book value. It never cancels losses.</p>
    <h3>Alpha balance</h3><p>The frozen bot benchmark is not universal balance. A lone extractor strongly counters pure traders, pure trading is weak with two players, Logistics objectives and automatic two-scan buying underperformed with those bots, and limited final-price incentives remain.</p>`);
}

function worthDialog() {
  const b = state.you.breakdown;
  modal('What counts toward net worth', `<dl class="worth-explain">${COMPONENTS.map(([k, l, why]) => `<div><dt>${l}</dt><dd><span class="num">${money(b[k])}</span><span>${why}</span></dd></div>`).join('')}
    <div class="sum"><dt>Total</dt><dd><span class="num">${money(total(b))}</span><span>Includes your private objective. Public standings show everyone without objectives until the end.</span></dd></div></dl>
    <p class="hint">Fuel, scanners and unused insurance have no score value.</p>`);
}

function keyDialog() {
  modal('Your private rejoin key', `<p>This key restores <b>${esc(state.you.name)}</b> in room <b>${state.code}</b> on another browser. Anyone with it can act as you, so keep it private, and don’t include it in screenshots.</p>
    <label for="key-text">Rejoin key</label><textarea id="key-text" readonly rows="3">${esc(session.key)}</textarea>
    <div class="dialog-actions">${btn(`${icon('copy')}Copy key`, 'copy-key', {id: 'copy-key'})}</div>
    <p class="hint">Saved in this browser. Copy it somewhere safe before clearing browser data; it can’t be recovered.</p>`);
}

// ---------- landing ----------

function renderLanding() {
  if ($('#landing')) { updateLanding(); return; }
  const saved = Object.entries(read('sx-sessions') || {});
  const invited = new URLSearchParams(location.search).get('room');
  if (invited && /^[A-Za-z2-9]{6}$/.test(invited)) entryMode = 'join';
  $('#app').innerHTML = `<div id="landing" class="landing">
    <header class="landing-top"><div class="brand">${mark()}<span>Salvage Exchange</span></div>${btn(`${icon('help')}How to play`, 'help', {cls: 'btn-ghost', id: 'landing-help'})}</header>
    <main id="main" class="landing-main" tabindex="-1">
      <section class="landing-intro"><p class="kicker">Multiplayer alpha · 2–4 crews · 6 rounds</p>
        <h1>Crack the wreck.<br><span>Play the market.</span></h1>
        <p class="lede">Send salvage drones into three hazardous sites, bid against rival crews for access, and trade what comes back. Every crew plans in secret; every haul moves the same market.</p></section>

      <section class="entry" aria-labelledby="entry-title"><h2 id="entry-title">Start or join a match</h2>
        ${landingNotice ? `<div class="banner error" role="alert">${icon('alert')}<div><p>${esc(landingNotice)}</p></div></div>` : ''}
        <div class="seg seg-wide" role="group" aria-label="Create or join">
          <button type="button" class="seg-btn" id="mode-create" data-action="mode" data-mode="create" aria-pressed="${entryMode === 'create'}">Create a room</button>
          <button type="button" class="seg-btn" id="mode-join" data-action="mode" data-mode="join" aria-pressed="${entryMode === 'join'}">Join a room</button></div>
        <form id="entry-form" novalidate>
          <div class="field"><label for="entry-name">Corporation name</label><input id="entry-name" name="name" maxlength="24" autocomplete="organization" placeholder="e.g. Orion Salvage" aria-describedby="err-entry-name">
            <p class="field-error" id="err-entry-name" hidden></p></div>
          <div class="field" id="code-field" ${entryMode === 'join' ? '' : 'hidden'}><label for="entry-code">Room code</label><input id="entry-code" name="code" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" class="code-input" value="${invited ? esc(invited.toUpperCase()) : ''}" aria-describedby="code-hint err-entry-code">
            <p class="hint" id="code-hint">Six characters from your host. Letters and digits 2–9; no I, O, 0 or 1.</p><p class="field-error" id="err-entry-code" hidden></p></div>
          <p class="field-error" id="err-entry" role="alert" hidden></p>
          <button class="btn btn-primary btn-block" type="submit" id="entry-submit">${entryMode === 'join' ? 'Join room' : 'Create room'}</button>
        </form>
        ${saved.length ? `<div class="saved"><h3>Your rooms on this browser</h3><ul>${saved.map(([code, x]) => `<li>${btn(`<span><b>${esc(x.name)}</b><span class="hint">Room ${esc(code)}</span></span><span>Open</span>`, 'resume', {cls: 'saved-room', id: `resume-${esc(code)}`, attrs: `data-code="${esc(code)}"`})}</li>`).join('')}</ul></div>` : ''}
        ${disclosure('rejoin', 'Restore your corporation with a rejoin key', `<p>Use the private key from <b>Menu → Your rejoin key</b> on your other browser. A room code alone can’t restore a seat.</p>
          <form id="rejoin-form" novalidate><div class="field"><label for="rejoin-code">Room code</label><input id="rejoin-code" name="code" maxlength="6" autocomplete="off" class="code-input"></div>
          <div class="field"><label for="rejoin-key">Private rejoin key</label><input id="rejoin-key" name="key" type="password" maxlength="64" autocomplete="off" aria-describedby="err-rejoin"></div>
          <p class="field-error" id="err-rejoin" role="alert" hidden></p><button class="btn btn-block" type="submit" id="rejoin-submit">Restore</button></form>`)}
      </section>
      <ul class="manifest" aria-label="The three salvage sites">${[0, 1, 2].map(j => `<li class="s${j}">${art(j)}<b>${SECTORS[j]}</b><span>${GOODS[j]} · ${['steady', 'risky', 'dangerous'][j]}</span></li>`).join('')}</ul></main>
    <footer class="foot"><span>Frozen economy v0.2 · alpha</span><span>Known balance limits are listed under How to play.</span></footer></div>`;
}

function updateLanding() {
  $('#code-field')?.toggleAttribute('hidden', entryMode !== 'join');
  for (const m of ['create', 'join']) $(`#mode-${m}`)?.setAttribute('aria-pressed', String(entryMode === m));
  const submit = $('#entry-submit');
  if (submit) { submit.textContent = entryMode === 'join' ? 'Join room' : 'Create room'; submit.disabled = busy; }
}

function fieldMsg(id, text) {
  const el = $(`#${id}`); if (!el) return;
  el.textContent = text || ''; el.hidden = !text;
  const input = el.id.startsWith('err-entry-') ? $(`#${el.id.replace('err-', '')}`) : null;
  input?.setAttribute('aria-invalid', String(!!text));
}

function entryError(err, code) {
  const m = err.message;
  if (!err.status) return ['err-entry', 'Can’t reach the server. Check your connection and try again.'];
  if (m === 'Room not found') return ['err-entry-code', `No room ${code} on this server. Check the code with your host.`];
  if (m === 'Room is full') return ['err-entry-code', 'That room already has four crews.'];
  if (/already started/.test(m)) return ['err-entry-code', 'That match has started, so new crews can’t join. If you were in it, open it from “Your rooms” or restore it with your rejoin key.'];
  if (/name already in use/.test(m)) return ['err-entry-name', 'Another crew in that room uses this name. Pick a different one.'];
  if (err.status === 422) return ['err-entry-name', 'Use 1–24 visible characters.'];
  return ['err-entry', m];
}

// ---------- session lifecycle ----------

async function resume(code, key) {
  const requested = {code, key, generation: ++sessionGeneration};
  session = requested;
  const receipt = read(`sx-pending-${code}`);
  pending = receipt?.owner === key ? receipt.command : null;
  pendingScope = receipt?.scope || '';
  const v = await api(`/rooms/${code}`, undefined, key);
  if (!isCurrentResponse(state, v, requested, session)) return;
  save('sx-active', session);
  landingNotice = '';
  accept(v, true, requested);
  if (pending && !busy) await sendPending();
}

function leave() {
  state = null; session = null; pending = null; flash = null; view = 'ops'; menuOpen = false; timelineOpen = false;
  forget('sx-active'); clearTimeout(seq.timer);
  $('#app').innerHTML = '';
  if ($('#dialog').open) $('#dialog').close();
  render();
  $('#main')?.focus();
}

async function copy(text, buttonId, done) {
  try {
    await navigator.clipboard.writeText(text);
    const b = buttonId && document.getElementById(buttonId);
    if (b) { b.classList.add('copied'); setTimeout(() => b.classList.remove('copied'), 1600); }
    toast(done);
  } catch { toast('Couldn’t copy automatically. Select the text and copy it instead.'); }
}

// ---------- events ----------

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!['entry-form', 'rejoin-form'].includes(form.id)) return;
  event.preventDefault();
  if (busy) return;
  const f = new FormData(form);
  if (form.id === 'rejoin-form') {
    const code = String(f.get('code')).trim().toUpperCase(), key = String(f.get('key')).trim();
    if (!/^[A-Z2-9]{6}$/.test(code) || !/^[a-f0-9]{64}$/.test(key)) { fieldMsg('err-rejoin', 'Enter the six-character room code and the 64-character key.'); return; }
    busy = true; $('#rejoin-submit').disabled = true;
    try { await resume(code, key); const saved = read('sx-sessions') || {}; saved[code] = {key, name: state.you.name}; save('sx-sessions', saved); }
    catch (err) { session = null; fieldMsg('err-rejoin', err.status === 401 ? 'That key doesn’t open this room.' : err.status === 404 ? `No room ${code} on this server.` : 'Can’t reach the server. Try again.'); }
    finally { busy = false; const b = $('#rejoin-submit'); if (b) b.disabled = false; }
    return;
  }
  const joining = entryMode === 'join', name = String(f.get('name') || '').trim(), code = String(f.get('code') || '').trim().toUpperCase();
  fieldMsg('err-entry-name', ''); fieldMsg('err-entry-code', ''); fieldMsg('err-entry', '');
  let bad = false;
  if (!name) { fieldMsg('err-entry-name', 'Enter a corporation name.'); bad = true; }
  if (joining && !/^[A-Z2-9]{6}$/.test(code)) { fieldMsg('err-entry-code', 'Room codes are six characters: letters and digits 2–9.'); bad = true; }
  if (bad) { $(`#${!name ? 'entry-name' : 'entry-code'}`).focus(); return; }
  busy = true; updateLanding();
  try {
    const previous = read('sx-entry-pending');
    const identity = previous && previous.code === (joining ? code : '') ? previous : {code: joining ? code : '', key: keygen()};
    save('sx-entry-pending', identity);
    const v = await api(joining ? `/rooms/${code}/join` : '/rooms', {name, rejoin_key: identity.key}, null);
    session = {code: v.code, key: identity.key, generation: ++sessionGeneration};
    const saved = read('sx-sessions') || {}; saved[v.code] = {key: session.key, name: v.you.name}; save('sx-sessions', saved);
    save('sx-active', session); forget('sx-entry-pending'); pending = null;
    busy = false;
    accept(v, true);
    if (location.search) history.replaceState(null, '', '/');
    $('#main')?.focus();
  } catch (err) {
    if (!state) session = null;
    const [id, msg] = entryError(err, code);
    fieldMsg(id, msg);
  } finally { busy = false; if (!state) updateLanding(); }
});

document.addEventListener('click', async event => {
  if (menuOpen && !event.target.closest('.menu-wrap')) { menuOpen = false; render(); }
  if (timelineOpen && !event.target.closest('.phase')) { timelineOpen = false; render(); }
  const b = event.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const a = b.dataset.action, d = b.dataset;
  if (b.closest('#menu')) { menuOpen = false; render(); $('#menu-toggle')?.focus(); }
  if (b.hasAttribute('data-cmd')) busyId = b.id;
  try {
    switch (a) {
      case 'help': help(); break;
      case 'key': keyDialog(); break;
      case 'worth': worthDialog(); break;
      case 'review': reviewDialog(); break;
      case 'close-dialog': $('#dialog').close(); break;
      case 'home': leave(); break;
      case 'menu': menuOpen = !menuOpen; timelineOpen = false; render(); if (menuOpen) $$('#menu .menu-item').find(el => el.offsetParent !== null)?.focus(); break;
      case 'timeline': timelineOpen = !timelineOpen; menuOpen = false; render(); break;
      case 'view': view = d.view; menuOpen = false; render(); $('#main').focus({preventScroll: true}); window.scrollTo({top: 0}); if (view === 'ops') schedulePreview(); break;
      case 'retry': await sendPending(); break;
      case 'dismiss': flash = null; render(); break;
      case 'mode': entryMode = d.mode; updateLanding(); fieldMsg('err-entry-code', ''); (entryMode === 'join' ? $('#entry-code') : $('#entry-name')).focus(); break;
      case 'resume': try { await resume(d.code, read('sx-sessions')[d.code].key); } catch (err) { session = null; landingNotice = `Couldn’t open room ${d.code}: ${err.status === 404 ? 'it no longer exists on this server' : err.status === 401 ? 'the key saved in this browser doesn’t open it, or the room was removed' : err.message}.`; $('#app').innerHTML = ''; render(); } break;
      case 'copy-code': await copy(state.code, b.id, `Room code ${state.code} copied.`); break;
      case 'copy-invite': await copy(`Join my Salvage Exchange match: room ${state.code} at ${location.origin}/?room=${state.code}`, b.id, 'Invite copied. It contains only the room code.'); break;
      case 'copy-key': await copy(session.key, b.id, 'Rejoin key copied. Keep it private.'); break;
      case 'start': case 'ready': await command(a); break;
      case 'scan': await command('scan', {target: d.target, sector: Number(d.sector)}, 'scan'); break;
      case 'fuel': await command('purchase', {item: 'fuel', quantity: Number(fuelQty)}, 'fuel'); break;
      case 'fuel-step': { const q = Number(fuelQty); fuelQty = String(Math.max(1, Math.min(16, (Number.isInteger(q) ? q : 0) + Number(d.step)))); $('#fuel-qty').value = fuelQty; updateLive(); break; }
      case 'purchase': await command('purchase', {item: d.item, ...(d.id === undefined ? {} : {drone_id: Number(d.id)})}, 'purchase'); break;
      case 'retire': { const dr = state.you.drones.find(x => x.id === Number(d.id));
        modal(`Retire ${droneName(d.id)}?`, `<p>${droneName(d.id)} will be removed from your fleet permanently. You receive <b>0 credits</b> and lose its <b class="num">${money(dr.disabled ? dr.value * .25 : dr.value)}</b> fleet value from your score.</p>
          <p class="hint">Retiring only frees a fleet slot (limit 5). It can’t be undone.</p>
          <div class="dialog-actions">${btn('Keep drone', 'close-dialog', {id: 'retire-cancel', attrs: 'autofocus'})}${btn('Retire for 0 credits', 'confirm-retire', {cls: 'btn-danger', id: 'retire-confirm', attrs: `data-id="${d.id}"`})}</div>`);
        break; }
      case 'confirm-retire': $('#dialog').close(); await command('purchase', {item: 'retire', drone_id: Number(d.id)}, 'purchase'); break;
      case 'assign': {
        const id = d.drone, j = Number(d.sector);
        if (draft.allocation[id] === j) delete draft.allocation[id]; else draft.allocation[id] = j;
        draftChanged(); break; }
      case 'side': draft[d.kind][d.j].side = d.side; draftChanged(); break;
      case 'step': {
        const o = draft[d.kind][d.j], whole = d.kind === 'shares', t = String(o.qty).trim(), cur = Number(t);
        const next = Math.max(0, (t !== '' && Number.isFinite(cur) ? cur : 0) + Number(d.step));
        o.qty = String(whole ? Math.round(next) : Number(next.toFixed(3)));
        $(`#qty-${d.kind}-${d.j}`).value = o.qty; draftChanged(); break; }
      case 'max': {
        const o = draft[d.kind][d.j], m = evaluation().maxima[d.kind][d.j];
        if (o.side === 'hold') o.side = 'buy';
        o.qty = String(o.side === 'sell' ? m.sell : m.buy);
        $(`#qty-${d.kind}-${d.j}`).value = o.qty; draftChanged(); break; }
      case 'lock': {
        const ev = evaluation();
        if (!ev.valid) { reviewDialog(); break; }
        $('#dialog').close();
        await command('lock', {plan: ev.plan}, 'lock'); break; }
      case 'goto': { $('#dialog').close(); const t = document.getElementById(d.target); t?.scrollIntoView({block: 'center'}); (t?.matches('input,button') ? t : t?.querySelector('input,button'))?.focus({preventScroll: true}); break; }
      case 'seq-skip': endSequence(); announce('Showing the full result.'); break;
      case 'seq-replay': {
        const el = $('.seq-live'); if (!el) break;
        if (reduceMotion()) { announce('Reduced motion is on, so the result is shown without playback.'); break; }
        clearTimeout(seq.timer); el.classList.remove('playing'); void el.offsetWidth; el.classList.add('playing');
        seq.playing = true; setNote('Replaying the settlement that already ran. Nothing is recalculated.');
        seq.timer = setTimeout(endSequence, 3700); break; }
    }
  } catch (err) { setFlash('general', err.message); }
});

document.addEventListener('input', event => {
  const el = event.target, f = el.dataset.field;
  if (el.id === 'entry-name') fieldMsg('err-entry-name', '');
  if (el.id === 'entry-code') fieldMsg('err-entry-code', '');
  if (!state || !f) return;
  if (f === 'bid') { draft.bids[Number(el.dataset.j)] = el.value; draftChanged(); }
  else if (f === 'qty') { draft[el.dataset.kind][Number(el.dataset.j)].qty = el.value; draftChanged(); }
  else if (f === 'rival') { rivalFactor = Number(el.value); $('#rival-out').textContent = `${rivalFactor.toFixed(1)}× neutral`; schedulePreview(); }
  else if (f === 'fuel') { fuelQty = el.value; updateLive(); }
});

document.addEventListener('change', event => {
  const el = event.target;
  if (state && el.dataset.field === 'contract') { draft.contracts[Number(el.dataset.j)] = el.checked; draftChanged(); }
});

document.addEventListener('toggle', event => {
  const key = event.target.dataset?.key;
  if (key) event.target.open ? openKeys.add(key) : openKeys.delete(key);
}, true);

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || $('#dialog').open) return;
  if (menuOpen) { menuOpen = false; render(); $('#menu-toggle')?.focus(); }
  else if (timelineOpen) { timelineOpen = false; render(); $('#phase-toggle')?.focus(); }
});

let wasNarrow = narrow();
addEventListener('resize', () => { if (narrow() !== wasNarrow) { wasNarrow = narrow(); if (state) render(); } });

$('.dialog-close').addEventListener('click', () => $('#dialog').close());
$('#dialog').addEventListener('click', e => { if (e.target === $('#dialog')) $('#dialog').close(); });
$('#dialog').addEventListener('close', () => {
  const el = dialogReturn && document.getElementById(dialogReturn);
  if (el) el.focus();
  dialogReturn = null;
});

setInterval(async () => {
  if (!session || busy || polling) return;
  const requested = {...session};
  polling = true;
  try {
    const next = await api(`/rooms/${requested.code}`, undefined, requested.key);
    if (!accept(next, false, requested) && state) render();
  } catch {
    if (requested.generation === session?.generation && online) { online = false; render(); }
  } finally { polling = false; }
}, 2000);

const active = read('sx-active');
if (!active) render();
else {
  $('#app').innerHTML = '<main class="boot" id="main"><p>Reopening your room…</p></main>';
  resume(active.code, active.key).catch(err => {
    state = null; session = null;
    landingNotice = `Couldn’t reopen room ${active.code}: ${err.status === 404 ? 'it no longer exists on this server' : err.status === 401 ? 'the key saved in this browser doesn’t open it, or the room was removed' : 'the server didn’t answer'}. ${err.status ? '' : 'Try again from “Your rooms”.'}`;
    if (err.status) forget('sx-active');
    $('#app').innerHTML = ''; render();
  });
}
