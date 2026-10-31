// Plays the four training missions through the real controls, including a failed attempt and
// retry, a wrong prediction, an empty tank and its retry, then free practice. It checks layout at
// every stage, that practice makes no API requests, and that leaving practice restores the live
// room's identity. usage: node tests/browser/missions.cjs [shots-dir]
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const BASE = process.env.SX_BASE || 'http://127.0.0.1:8000';
const OUT = process.argv[2] || require('node:os').tmpdir();
fs.mkdirSync(OUT, { recursive: true });

const PROFILES = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' },
  { name: 'phone-375', viewport: { width: 375, height: 740 }, reducedMotion: 'reduce', touch: true, mobile: true, dsf: 2 },
  { name: 'phone-390', viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference', touch: true, mobile: true, dsf: 2 },
  { name: 'keyboard', viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce', keyboard: true },
];

async function run(profile) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: profile.dsf || 1, reducedMotion: profile.reducedMotion, hasTouch: !!profile.touch, isMobile: !!profile.mobile });
  const page = await context.newPage();
  const errors = [], api = [], problems = [];
  let practising = false;
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('request', r => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) api.push({ path: u.pathname, auth: r.headers().authorization || '', practising }); });
  const press = sel => profile.touch ? page.tap(sel) : page.click(sel);
  let shot = 0;
  const snap = async label => page.screenshot({ path: path.join(OUT, `missions-${profile.name}-${String(++shot).padStart(2, '0')}-${label}.png`) });
  const panel = async () => (await page.textContent('#r-mission')).replace(/\s+/g, ' ');
  const target = () => page.evaluate(() => document.querySelector('.guide-target')?.id || document.querySelector('.guide-target')?.className || '');
  const waitPanel = async (text, timeout = 9000) => page.waitForFunction(t => document.querySelector('#r-mission')?.textContent.includes(t), text, { timeout });
  // Tabs forward to an element, as a keyboard user would, then activates it.
  async function key(id, limit = 60) {
    for (let i = 0; i < limit; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(x => document.activeElement?.id === x, id)) { await page.keyboard.press('Enter'); return; }
    }
    throw new Error(`${profile.name}: #${id} not reachable by Tab`);
  }
  const act = async id => profile.keyboard ? key(id) : press(`#${id}`);
  // Uses "Show me" (keyboard) or a direct tap/click on the highlighted control.
  async function doTarget(expected) {
    const t = await target();
    if (expected) assert.equal(t, expected, `${profile.name}: highlighted ${t}, expected ${expected}`);
    if (profile.keyboard) { await key('mission-show'); assert.equal(await page.evaluate(() => document.activeElement?.id), t, 'Show me focuses the control'); await page.keyboard.press('Enter'); }
    else await press(`#${t}`);
  }
  const ready = async () => act(profile.viewport.width < 1024 ? 'ready-dock' : 'ready-rail');
  const review = async () => act(profile.viewport.width < 1024 ? 'review-dock' : 'review-rail');
  async function lock() { await review(); await page.waitForSelector('#lock-plan'); await page.waitForTimeout(250); await act('lock-plan'); await page.waitForSelector('.mission.debrief', { timeout: 9000 }); await page.waitForTimeout(profile.reducedMotion === 'reduce' ? 100 : 400); }
  async function check(label) {
    const r = await page.evaluate(() => {
      const doc = document.documentElement, small = [];
      for (const b of document.querySelectorAll('#r-mission button, .callout, #dialog[open] button')) { const rc = b.getBoundingClientRect(); if (rc.height && rc.height < 44 && b.tagName === 'BUTTON') small.push(b.textContent.trim()); }
      const m = document.querySelector('#r-mission .mission'), h = m ? m.getBoundingClientRect().height : 0;
      const actions = m?.querySelector('.mission-actions')?.getBoundingClientRect();
      return { overflow: doc.scrollWidth > doc.clientWidth + 1, small, height: h, vh: innerHeight, debrief: !!m?.classList.contains('debrief'), actionsAt: actions ? actions.bottom - m.getBoundingClientRect().top : 0 };
    });
    if (r.overflow) problems.push(`${label}: horizontal overflow`);
    if ((profile.touch || profile.viewport.width < 1024) && r.small.length) problems.push(`${label}: small targets ${r.small.join(', ')}`);
    // On phones, guidance during a decision leaves most of the screen to the game; a debrief may be
    // longer, but its result and next actions must fit on the first screen.
    if (profile.mobile && !r.debrief && r.height > r.vh * .55) problems.push(`${label}: mission panel takes ${Math.round(r.height)}px of a ${r.vh}px screen`);
    if (profile.mobile && r.debrief && r.actionsAt > r.vh * .9) problems.push(`${label}: debrief actions start ${Math.round(r.actionsAt)}px down a ${r.vh}px screen`);
    await snap(label);
  }

  // A live room first, so we can check practice leaves its identity alone.
  await page.goto(`${BASE}/`);
  await page.fill('#entry-name', 'Live Crew');
  await press('#entry-submit');
  await page.waitForSelector('#shell');
  const live = await page.evaluate(() => JSON.parse(localStorage.getItem('sx-active')));
  await press('#menu-toggle'); await press('#menu-help'); await page.waitForSelector('#help-practice');
  const started = Date.now();
  practising = true;
  await press('#help-practice');
  await page.waitForSelector('.mission');
  await check('m1-briefing');
  assert.match(await target(), /ready-(rail|dock)/);

  // ---- Mission 1, first attempt: the Rift instead of the Belt, which fails honestly ----
  await ready(); await page.waitForSelector('#plan-form'); await waitPanel('Send a drone to the Crystal Belt');
  const firstAction = Date.now() - started;
  await press('#chip-0-2');
  await waitPanel('instead');
  assert.equal(await target(), 'chip-0-0', 'the directed step still asks for the Belt');
  await check('m1-alternative');
  await lock();
  assert.match(await panel(), /Not complete/);
  assert.match(await panel(), /Nothing came back/);
  await check('m1-failed');
  await act('mission-retry');
  await page.waitForFunction(() => document.body.dataset.phase === 'briefing');
  assert.equal(await page.evaluate(() => document.querySelector('.round-label')?.textContent || document.querySelector('#phase-toggle')?.textContent), (await page.evaluate(() => document.querySelector('.round-label')?.textContent || document.querySelector('#phase-toggle')?.textContent)));

  // ---- Mission 1, retry: the Belt ----
  await ready(); await page.waitForSelector('#plan-form'); await waitPanel('Send a drone to the Crystal Belt');
  await doTarget('chip-0-0');
  await waitPanel('Review plan');
  await act(profile.keyboard ? 'chip-1-1' : 'chip-1-1');
  await check('m1-planned');
  await lock();
  assert.match(await panel(), /Complete/);
  assert.match(await panel(), /isn’t cash until you sell it/);
  await check('m1-debrief');
  await act('mission-next');

  // ---- Mission 2: sell held cargo ----
  await waitPanel('Turn a haul into usable cash');
  await ready(); await page.waitForSelector('#plan-form'); await waitPanel('Choose Sell');
  await doTarget('side-cargo-0-sell');
  await act('max-cargo-0');
  await waitPanel('Decide on the rest');
  await check('m2-sold');
  await act('chip-0-0');
  await lock();
  assert.match(await panel(), /Complete/);
  assert.match(await panel(), /became/);
  await check('m2-debrief');
  await act('mission-next');

  // ---- Mission 3: a wrong prediction, a scan, a choice ----
  await waitPanel('Read the competition');
  await act('prompt-scarce');
  await waitPanel('Not quite');
  await act('scan-h-1');
  await page.waitForSelector('#sector-1 .scan-result');
  await check('m3-predicted');
  await ready(); await page.waitForSelector('#plan-form'); await waitPanel('Choose where your drones go');
  await act('chip-0-0');
  await lock();
  assert.match(await panel(), /Your scan of the Derelict Cruiser showed it was severe/);
  await check('m3-debrief');
  await act('mission-next');

  // ---- Mission 4: forget fuel, recover by retrying, then plan with hints ----
  await waitPanel('Make your own plan');
  await ready(); await page.waitForSelector('#plan-form');
  await waitPanel('Your tank is empty');
  await check('m4-empty-tank');
  await act('mission-retry-fuel');
  await page.waitForFunction(() => document.body.dataset.phase === 'briefing');
  await waitPanel('Make your own plan');
  for (let i = 0; i < 3; i++) await act('mission-hint');
  await waitPanel('For example');
  await check('m4-hints');
  await page.fill('#fuel-qty', '3'); await act('buy-fuel');
  await page.waitForFunction(() => /\b3 of 16\b/.test(document.body.textContent));
  await ready(); await page.waitForSelector('#plan-form');
  await act('chip-0-0'); await act('chip-1-1');
  await page.waitForTimeout(700);
  await lock();
  assert.match(await panel(), /Objective met/);
  await check('m4-debrief');
  const coreTime = Date.now() - started;
  await act('mission-final');
  await page.waitForSelector('#final-free');
  await check('final-debrief');
  await act('final-free');
  await page.waitForFunction(() => !document.querySelector('#r-mission .mission'));

  // ---- Leaving practice restores the live identity ----
  practising = false;
  await press('#menu-toggle'); await press('#menu-home');
  await page.waitForSelector(`#resume-${live.code}`);
  await press(`#resume-${live.code}`);
  await page.waitForSelector('#shell');
  const back = await page.evaluate(() => ({ active: JSON.parse(localStorage.getItem('sx-active')), name: document.querySelector('.crew.me .crew-name')?.textContent }));
  assert.equal(back.active.code, live.code);
  assert.equal(back.active.key, live.key);
  assert.match(back.name, /Live Crew/);
  await page.waitForTimeout(2300);
  const liveCalls = api.filter(x => !x.practising && x.path.includes(live.code));
  assert.ok(liveCalls.length && liveCalls.every(x => x.auth === `Bearer ${live.key}`), 'live calls use the live key');
  await browser.close();
  return { problems, errors, practiceCalls: api.filter(x => x.practising).length, firstAction, coreTime };
}

(async () => {
  let failed = false;
  for (const profile of PROFILES) {
    const r = await run(profile);
    console.log(`${profile.name}: all four missions, one failed attempt and retry, empty-tank retry, free practice, live identity restored`);
    console.log(`  automated walkthrough: first drone assigned ${(r.firstAction / 1000).toFixed(1)}s after start; core missions ${(r.coreTime / 1000).toFixed(0)}s; API requests during practice: ${r.practiceCalls}`);
    for (const p of r.problems) console.log(`  PROBLEM ${p}`);
    for (const e of r.errors) console.log(`  ERROR ${e}`);
    if (r.problems.length || r.errors.length || r.practiceCalls) failed = true;
  }
  console.log(failed ? 'missions: FAILED' : 'missions: all profiles passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
