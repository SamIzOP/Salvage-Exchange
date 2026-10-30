// Plays the guided practice the way a newcomer would: reads each guide step, uses the control it
// highlights, and checks the card never covers that control, stays on screen, and that practice
// sends no API traffic. usage: node tests/browser/tutorial.cjs [shots-dir]
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const BASE = process.env.SX_BASE || 'http://127.0.0.1:8000';
const OUT = process.argv[2] || require('node:os').tmpdir();
fs.mkdirSync(OUT, { recursive: true });

const PROFILES = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' },
  { name: 'phone', viewport: { width: 375, height: 740 }, reducedMotion: 'reduce', touch: true, mobile: true, dsf: 2 },
  { name: 'tablet', viewport: { width: 768, height: 1024 }, reducedMotion: 'no-preference', touch: true },
  // Keyboard only: every step is reached and operated with Tab, Enter and Space.
  { name: 'keyboard', viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce', keyboard: true },
];

const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

// Everything the checks need, read from the page as a player would see it.
const snapshot = page => page.evaluate(() => {
  const root = document.querySelector('.coach');
  if (!root || root.hidden) return null;
  const rect = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const card = root.querySelector('.coach-card'), ring = root.querySelector('.coach-ring');
  const ringRect = ring.hidden ? null : rect(ring);
  // The highlighted control is whatever sits under the ring's centre; the guide itself ignores the pointer.
  let target = null;
  if (ringRect) {
    const x = ringRect.left + ringRect.width / 2, y = ringRect.top + Math.min(ringRect.height / 2, 30);
    const hit = document.elementsFromPoint(x, y).find(el => !root.contains(el) && el !== document.documentElement && el !== document.body);
    const control = hit?.closest('button, input');
    target = hit ? { tag: hit.tagName, id: hit.closest('[id]')?.id || '', control: control?.id || '', rect: control ? rect(control) : null } : null;
  }
  const dock = document.querySelector('.dock');
  const dockRect = dock && getComputedStyle(dock).display !== 'none' ? rect(dock) : null;
  const small = root.classList.contains('min') ? [] : [...card.querySelectorAll('button')].filter(b => b.getBoundingClientRect().height < 44).map(b => b.textContent.trim());
  return {
    title: card.querySelector('#coach-title')?.textContent, count: card.querySelector('.coach-count')?.textContent,
    min: root.classList.contains('min'), acting: root.classList.contains('acting'), card: rect(card), ring: ringRect, target,
    dialog: !!root.closest('dialog'), dock: dockRect, vw: document.documentElement.clientWidth, vh: innerHeight,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, small,
    buttons: [...card.querySelectorAll('button')].map(b => b.textContent.trim()), focus: document.activeElement?.closest('.coach-card') ? 'card' : document.activeElement?.id || document.activeElement?.tagName,
  };
});

async function waitStep(page, previous, timeout = 9000) {
  const until = Date.now() + timeout;
  for (;;) {
    const s = await snapshot(page);
    if (s && s.title !== previous) return s;
    if (Date.now() > until) throw new Error(`guide did not move past “${previous}”`);
    await page.waitForTimeout(120);
  }
}

async function run(profile) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: profile.dsf || 1, reducedMotion: profile.reducedMotion, hasTouch: !!profile.touch, isMobile: !!profile.mobile });
  const page = await context.newPage();
  const errors = [], api = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) api.push(`${r.method()} ${new URL(r.url()).pathname}`); });
  await page.goto(`${BASE}/`);
  await page.fill('#entry-name', 'Orion Salvage');
  const press = sel => profile.touch ? page.tap(sel) : page.click(sel);
  // Tabs forward to an element, as a keyboard user would, then activates it.
  async function key(match, limit = 14) {
    for (let i = 0; i < limit; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(m => { const a = document.activeElement; return !!a && (a.id === m || a.textContent.trim() === m); }, match)) {
        await page.keyboard.press('Enter');
        return;
      }
    }
    throw new Error(`${profile.name}: “${match}” not reachable within ${limit} Tab presses from ${await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)}`);
  }
  if (profile.keyboard) { await page.focus('#entry-name'); await key('practice-start', 40); }
  else await press('#practice-start');
  await page.waitForSelector('#shell');
  const seen = [], problems = [];
  let s = await waitStep(page, null), shot = 0;
  for (let guard = 0; guard < 60; guard++) {
    // Let the spotlight finish moving (and any scroll settle) before judging the layout.
    await page.waitForTimeout(profile.reducedMotion === 'reduce' ? 80 : 700);
    s = await snapshot(page) || s;
    seen.push(s.title);
    const where = `${profile.name} “${s.title}”`;
    if (s.overflow) problems.push(`${where}: horizontal overflow`);
    const c = s.card;
    if (c.left < 0 || c.top < 0 || c.right > s.vw + 0.5 || c.bottom > s.vh + 0.5) problems.push(`${where}: card off screen ${JSON.stringify(c)}`);
    if (s.dock && !s.dialog && c.bottom > s.dock.top + 1) problems.push(`${where}: card covers the dock`);
    // The control to press must stay clear; for a larger target, its first lines must.
    if (s.ring && s.acting && s.target?.rect && overlap(s.card, s.target.rect) > 0) problems.push(`${where}: card covers the control it points at`);
    const headTop = Math.max(0, s.ring?.top ?? 0), head = s.ring && { left: s.ring.left, right: s.ring.right, top: headTop, bottom: Math.min(s.ring.bottom, headTop + 100) };
    if (head && overlap(s.card, head) > 0) problems.push(`${where}: card covers the start of its target`);
    if ((profile.touch || profile.viewport.width < 1024) && s.small.length) problems.push(`${where}: small touch targets ${s.small.join(', ')}`);
    await page.screenshot({ path: path.join(OUT, `tutorial-${profile.name}-${String(++shot).padStart(2, '0')}.png`) });
    const title = s.title;
    if (profile.keyboard) {
      if (s.focus !== 'card') problems.push(`${where}: focus is on ${s.focus}, not the guide`);
      if (s.buttons.includes('Keep playing')) { await key('Keep playing'); break; }
      if (!s.acting) await key(s.buttons.at(-1));
      else {
        await key('Show me');
        if (/Buy a company share/.test(title)) { await page.keyboard.press('Enter'); await key('qty-shares-0-inc'); }
        else await page.keyboard.press('Enter');
      }
      s = await waitStep(page, title);
      continue;
    }
    if (s.buttons.includes('Keep playing')) { await page.click('.coach-card >> text=Keep playing'); break; }
    if (!s.acting) await page.click('.coach-card [data-coach="next"]');
    else if (/Buy a company share/.test(title)) { await press('#side-shares-0-buy'); await press('#qty-shares-0-inc'); }
    else {
      assert.ok(s.target?.control, `${where}: no control under the spotlight`);
      await press(`#${s.target.control}`);
    }
    s = await waitStep(page, title);
  }
  // The guide is over; the practice keeps going against the rival to the end of the match.
  assert.equal(await page.locator('.coach').isHidden(), true, 'guide hides after the last step');
  for (let guard = 0; guard < 80; guard++) {
    const phase = await page.evaluate(() => document.body.dataset.phase);
    if (phase === 'finished') break;
    const ready = page.locator('#ready-main:not([disabled]), #ready-dock:visible:not([disabled])').first();
    const review = page.locator('#review-main');
    if (await page.locator('#seq-skip').isVisible().catch(() => false)) await page.click('#seq-skip');
    if (await ready.count() && await ready.isVisible()) await ready.click();
    else if (phase === 'planning' && await review.count()) { await review.click(); await page.click('#lock-plan'); }
    await page.waitForTimeout(600);
  }
  await page.waitForSelector('#practice-again');
  await page.screenshot({ path: path.join(OUT, `tutorial-${profile.name}-final.png`) });
  const final = await page.evaluate(() => [...document.querySelectorAll('.final-list li')].map(li => li.querySelector('.fl-who b').textContent.trim()));
  // Reloading resumes the practice in place, still with no server traffic.
  await page.reload();
  await page.waitForSelector('#practice-again');
  await browser.close();
  return { seen, problems, errors, api, final };
}

(async () => {
  let failed = false;
  for (const profile of PROFILES) {
    const r = await run(profile);
    console.log(`${profile.name}: ${r.seen.length} guide steps → ${r.seen.join(' | ')}`);
    console.log(`${profile.name}: final standings ${r.final.join(', ')}; API requests during practice: ${r.api.length}`);
    for (const p of r.problems) console.log(`  PROBLEM ${p}`);
    for (const e of r.errors) console.log(`  ERROR ${e}`);
    if (r.problems.length || r.errors.length || r.api.length) failed = true;
  }
  console.log(failed ? 'tutorial: FAILED' : 'tutorial: all profiles passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
