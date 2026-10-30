// Shared helpers for driving Salvage Exchange through its real HTTP API and browser UI.
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const BASE = process.env.SX_BASE || 'http://127.0.0.1:8000';
const SHOTS = process.env.SX_SHOTS || require('node:os').tmpdir();
// Fixtures run GameService directly; default to the project virtualenv.
const PYTHON = process.env.SX_PYTHON || require('node:path').join(__dirname, '../../.venv/bin/python');

const newKey = () => crypto.randomBytes(32).toString('hex');

async function api(path, body, key) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${BASE}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { const e = new Error(`${res.status} ${data.detail}`); e.status = res.status; throw e; }
  return data;
}

let counter = 0;
async function cmd(code, key, kind, extra = {}) {
  const v = await api(`/rooms/${code}`, undefined, key);
  return api(`/rooms/${code}/commands`, { kind, request_id: `h-${Date.now()}-${counter++}`, round: v.round, phase: v.phase, ...extra }, key);
}

async function createRoom(names) {
  const players = names.map(name => ({ name, key: newKey() }));
  const first = await api('/rooms', { name: players[0].name, rejoin_key: players[0].key });
  const code = first.code;
  for (const p of players.slice(1)) await api(`/rooms/${code}/join`, { name: p.name, rejoin_key: p.key });
  return { code, players };
}

async function openAs(browser, { code, key, name }, opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, deviceScaleFactor: opts.dsf || 1, reducedMotion: opts.reducedMotion || 'no-preference', hasTouch: !!opts.touch, isMobile: !!opts.mobile });
  if (code) {
    await context.addInitScript(([code, key, name]) => {
      if (!localStorage.getItem('sx-active')) {
        localStorage.setItem('sx-active', JSON.stringify({ code, key, generation: 1 }));
        const saved = JSON.parse(localStorage.getItem('sx-sessions') || '{}');
        saved[code] = { key, name };
        localStorage.setItem('sx-sessions', JSON.stringify(saved));
      }
    }, [code, key, name]);
  }
  const page = await context.newPage();
  page.on('pageerror', e => console.error(`[pageerror ${name}]`, e.message));
  page.on('console', m => { if (m.type() === 'error') console.error(`[console ${name}]`, m.text()); });
  await page.goto(BASE + '/');
  return { context, page };
}

async function overflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const offenders = [];
    if (doc.scrollWidth > doc.clientWidth + 1) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.right > doc.clientWidth + 1 && r.width > 0 && !el.closest('.table-scroll,.audit-scroll')) offenders.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(r.right)}`);
        if (offenders.length > 8) break;
      }
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, offenders };
  });
}

module.exports = { chromium, api, cmd, createRoom, openAs, newKey, overflow, BASE, SHOTS, PYTHON };
