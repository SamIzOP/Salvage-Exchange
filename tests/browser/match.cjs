// Full six-round, two-identity match played only through browser controls.
// Orion: desktop 1440, default motion. Nova: 375px touch phone, reduced motion, joins via invite link.
const assert = require('node:assert/strict');
const { chromium, BASE, overflow } = require('./lib.cjs');
const out = process.argv[2];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const num = t => Number(String(t).replace(/[^0-9.\-−+]/g, '').replace('−', '-'));
const cents = n => Math.round(n * 100);
const money = n => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = n => cents(n) === 0 ? '0.00' : `${cents(n) > 0 ? '+' : '−'}${money(Math.abs(cents(n)) / 100)}`;

async function server(page) {
  return page.evaluate(async () => {
    const a = JSON.parse(localStorage.getItem('sx-active'));
    const r = await fetch(`/api/rooms/${a.code}`, { headers: { Authorization: `Bearer ${a.key}` } });
    return r.json();
  });
}
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });

async function waitPhase(page, phase, round) {
  await page.waitForFunction(([phase, round]) => document.body.dataset.phase === phase &&
    (!round || document.querySelector('.round-label')?.textContent.includes(`Round ${round} `)), [phase, round], { timeout: 20000 });
}

async function click(page, sel) { const el = page.locator(sel).first(); await el.scrollIntoViewIfNeeded(); await el.click(); }

async function buyFuel(page, units) {
  await page.fill('#fuel-qty', String(units));
  const before = (await server(page)).you.fuel;
  await click(page, '#buy-fuel');
  await page.waitForFunction(b => document.querySelector('.fleet-note')?.textContent.includes(`and ${b} fuel`), before + units);
}

async function plan(page, me, round, choices) {
  const st = await server(page);
  const y = st.you;
  for (const [drone, sector] of choices.drones) {
    const d = y.drones.find(x => x.id === drone);
    if (!d || d.disabled) continue;
    await click(page, `#chip-${drone}-${sector}`);
  }
  const sent = new Set(choices.drones.filter(([id]) => y.drones.some(d => d.id === id && !d.disabled)).map(([, s]) => s));
  for (const [j, bid] of choices.bids || []) if (sent.has(j) && y.credits > 100) await page.fill(`#bid-${j}`, String(bid));
  for (const [kind, j, side, qty] of choices.orders || []) {
    await click(page, `#side-${kind}-${j}-${side}`);
    if (qty === 'max') await click(page, `#max-${kind}-${j}`);
    else await page.fill(`#qty-${kind}-${j}`, String(qty));
  }
  for (const j of choices.contracts || []) {
    const box = page.locator(`#contract-${j}`);
    if (!(await box.isDisabled())) await box.check();
  }
}

async function reviewAndLock(page, reviewSel, name) {
  await click(page, reviewSel);
  await page.waitForSelector('#dialog[open] #lock-plan');
  const disabled = await page.locator('#lock-plan').isDisabled();
  if (disabled) {
    const issues = await page.locator('#dialog .issues').innerText();
    throw new Error(`${name} plan invalid: ${issues}`);
  }
  if (name) { await page.waitForTimeout(400); await shot(page, name); }
  await click(page, '#lock-plan');
  await page.waitForFunction(() => document.querySelector('#r-locked') || ['upgrade', 'finished'].includes(document.body.dataset.phase), null, { timeout: 15000 });
}

async function verifyReveal(page, who) {
  const st = await server(page);
  const lg = st.history.at(-1), seat = st.you.seat, report = st.you.reports.find(r => r.round === lg.round);
  const big = await page.locator('#r-reveal .headline .big').innerText();
  assert.equal(num(big.split('\n')[0].replace(/cr.*/, '')), Number(signed(lg.deltas[seat]).replace('−', '-').replace(/,/g, '')), `${who} headline delta`);
  const rows = await page.$$eval('#r-reveal table.recon tbody tr', trs => trs.map(tr => [tr.querySelector('th').childNodes[0].textContent.trim(), tr.querySelector('td:last-child').innerText]));
  const parts = rows.filter(([k]) => ['Credits', 'Shares', 'Cargo', 'Contracts', 'Fleet', 'Rounding'].includes(k));
  const pub = rows.find(([k]) => k === 'Public change');
  const sumParts = parts.reduce((s, [, v]) => s + cents(num(v)), 0);
  assert.equal(sumParts, cents(num(pub[1])), `${who} components reconcile to public change`);
  assert.equal(cents(num(pub[1])), cents(lg.deltas[seat]), `${who} public change matches server delta`);
  const keys = ['credits', 'stocks', 'salvage', 'contracts', 'fleet'];
  for (const [i, k] of keys.entries()) assert.equal(cents(num(parts[i][1])), cents(report.after[k]) - cents(report.before[k]), `${who} ${k} change`);
  const obj = rows.find(([k]) => k === 'Objective');
  assert.equal(cents(num(obj[1])), cents(report.after.objective) - cents(report.before.objective), `${who} objective change`);
  // Displayed prices must be the recorded settlement prices.
  const moves = await page.$$eval('#r-reveal .moves li .num', els => els.map(e => e.innerText));
  moves.forEach((m, i) => { const [from, to] = m.split('→').map(num); const key = i < 3 ? ['opening_prices', 'prices'] : ['opening_stocks', 'stocks']; const j = i % 3;
    assert.equal(cents(from), cents(lg[key[0]][j])); assert.equal(cents(to), cents(lg[key[1]][j])); });
  return { delta: lg.deltas[seat], parts: parts.length, hits: report.hits.length, contracts: report.contracts.length };
}

(async () => {
  const browser = await chromium.launch();
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  await ctxA.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const A = await ctxA.newPage(), B = await ctxB.newPage();
  const errors = [];
  for (const [p, n] of [[A, 'Orion'], [B, 'Nova']]) {
    p.on('pageerror', e => errors.push(`${n}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') errors.push(`${n} console: ${m.text()}`); });
  }
  // Privacy watch: every room projection Nova receives must hide Orion's live plan, scans and objective.
  const leaks = [];
  B.on('response', async res => {
    if (!/\/api\/rooms\/[A-Z0-9]{6}(\/commands)?$/.test(new URL(res.url()).pathname) || !res.ok()) return;
    try {
      const st = await res.json();
      for (const p of st.players) if (p.seat !== st.you.seat) {
        for (const k of ['plan', 'scans', 'reports', 'bids', 'allocation']) if (k in p) leaks.push(`${k} in opponent ${p.name}`);
        if (st.phase !== 'finished' && 'objective' in p) leaks.push('objective before finish');
      }
      if (['briefing', 'planning'].includes(st.phase) && st.history.some(h => h.round >= st.round)) leaks.push('current round in history');
    } catch {}
  });

  // ---- lobby through the real entry forms ----
  await A.goto(BASE + '/');
  await A.fill('#entry-name', 'Orion Salvage');
  await shot(A, '01-landing-desktop');
  await A.click('#entry-submit');
  await waitPhase(A, 'lobby');
  const code = (await A.locator('.room-code').innerText()).trim();
  await A.click('#copy-invite');
  const invite = await A.evaluate(() => navigator.clipboard.readText());
  assert.match(invite, new RegExp(`/\\?room=${code}$`));
  assert.ok(!/[a-f0-9]{64}/.test(invite), 'invite must not contain a rejoin key');
  log('room', code, 'invite ok');
  const startDisabled = await A.locator('#start-main').isDisabled();
  assert.ok(startDisabled, 'host cannot start alone');
  assert.match(await A.locator('#start-main-why').innerText(), /Needs at least 2 crews/);

  await B.goto(invite.split(' at ')[1]);
  assert.equal(await B.locator('#mode-join').getAttribute('aria-pressed'), 'true');
  assert.equal(await B.inputValue('#entry-code'), code);
  await B.fill('#entry-name', 'orion salvage');
  await B.click('#entry-submit');
  await B.waitForSelector('#err-entry-name:not([hidden])');
  assert.match(await B.locator('#err-entry-name').innerText(), /uses this name/);
  await shot(B, '02-join-name-error-phone');
  await B.fill('#entry-name', 'Nova Works');
  await B.click('#entry-submit');
  await waitPhase(B, 'lobby');
  await A.waitForFunction(() => !document.querySelector('#start-main').disabled);
  await shot(A, '03-lobby-desktop');
  await shot(B, '04-lobby-phone');
  await A.click('#start-main');
  await waitPhase(A, 'briefing', 1); await waitPhase(B, 'briefing', 1);
  log('started');

  const results = [];
  for (let round = 1; round <= 6; round++) {
    // ---- briefing ----
    const sa = await server(A), sb = await server(B);
    if (round === 1) {
      await click(A, '#scan-h-2');
      await A.waitForSelector('#sector-2 .scan-result');
      await click(B, '#scan-e-0');
      await B.waitForSelector('.events .scan-result');
      await shot(A, '05-briefing-desktop');
      await shot(B, '06-briefing-phone');
    }
    const fa = Math.min(16 - sa.you.fuel, 6, Math.floor((sa.you.credits - 40) / 8)), fb = Math.min(16 - sb.you.fuel, 4, Math.floor((sb.you.credits - 40) / 8));
    if (sa.you.fuel < 8 && fa > 0) await buyFuel(A, fa);
    if (sb.you.fuel < 6 && fb > 0) await buyFuel(B, fb);
    await click(A, '#ready-main');
    await A.waitForSelector('#r-brief .next-step >> text=You’re ready');
    await click(B, '#ready-dock');
    await waitPhase(A, 'planning', round); await waitPhase(B, 'planning', round);

    // ---- planning ----
    const ya = (await server(A)).you, yb = (await server(B)).you;
    const aOrders = [];
    if (ya.credits > 120) aOrders.push(['cargo', 0, 'buy', 1]);
    if (round === 1) aOrders.push(['shares', 0, 'buy', 1]);
    if (round === 4 && ya.shares[0] > 0) aOrders.push(['shares', 0, 'sell', 'max']);
    if (ya.inventory[2] >= 1 && round >= 3) aOrders.push(['cargo', 2, 'sell', 1]);
    await plan(A, 'A', round, { drones: [[0, 0], [1, 2], [2, 0]], bids: round % 2 ? [[2, 5]] : [], orders: aOrders, contracts: round >= 3 ? [0] : [] });
    const bOrders = yb.credits > 120 && round <= 2 ? [['cargo', 1, 'buy', 1]] : [];
    await plan(B, 'B', round, { drones: [[0, 0], [1, 1]], orders: bOrders, contracts: round >= 3 ? [1] : [] });
    if (round === 1) { await shot(A, '07-planning-desktop'); await B.locator('#sector-1').scrollIntoViewIfNeeded(); await shot(B, '08-planning-phone'); }
    await reviewAndLock(A, '#review-rail', round === 1 ? '09-review-desktop' : '');
    if (round === 1) {
      await A.waitForSelector('#r-locked');
      await shot(A, '10-locked-waiting-desktop');
      assert.match(await A.locator('#r-locked').innerText(), /Waiting for Nova Works/);
    }
    await reviewAndLock(B, '#review-dock', round === 1 ? '11-review-phone' : '');

    // ---- reveal ----
    const endPhase = round === 6 ? 'finished' : 'upgrade';
    await waitPhase(A, endPhase); await waitPhase(B, endPhase);
    if (round === 1) {
      await A.waitForTimeout(700);
      assert.ok(await A.locator('.seq-live.playing').count(), 'reveal plays for default motion');
      await shot(A, '12-reveal-playing-desktop');
      assert.equal(await B.locator('.seq-live.playing').count(), 0, 'reduced motion shows the settled summary immediately');
    }
    await A.waitForFunction(() => !document.querySelector('.seq-live.playing'), null, { timeout: 6000 });
    const ra = await verifyReveal(A, `Orion r${round}`), rb = await verifyReveal(B, `Nova r${round}`);
    results.push({ round, orion: ra, nova: rb });
    log('round', round, 'verified', JSON.stringify({ orion: ra.delta, nova: rb.delta, hitsA: ra.hits, hitsB: rb.hits, contracts: ra.contracts + rb.contracts }));
    if (round === 1) { await shot(A, '13-reveal-desktop'); await shot(B, '14-reveal-phone'); }
    // A replay must not change the record or the phase.
    if (round === 2) {
      await click(A, '#seq-replay');
      assert.ok(await A.locator('.seq-live.playing').count());
      await click(A, '#seq-skip');
      assert.equal(await A.locator('.seq-live.playing').count(), 0);
      assert.equal((await server(A)).phase, 'upgrade');
    }
    if (round === 6) break;

    // ---- refit ----
    for (const [P, who] of [[A, 'A'], [B, 'B']]) {
      const y = (await server(P)).you;
      for (const d of y.drones) if (d.disabled && y.credits > 60) { await click(P, `#repair-${d.id}`); await P.waitForSelector(`#repair-${d.id}`, { state: 'detached' }); }
      if (who === 'A' && round === 2) { await click(P, '#insure-1'); await P.waitForSelector('#insure-1', { state: 'detached' }); }
      if (who === 'A' && round === 3 && (await server(P)).you.credits > 90) { await click(P, '#buy-scanner'); await P.waitForSelector('.shop-item >> text=Installed'); }
    }
    if (round === 2) await shot(A, '15-refit-desktop');
    await click(A, '#ready-main');
    await click(B, '#ready-dock');
    await waitPhase(A, 'briefing', round + 1); await waitPhase(B, 'briefing', round + 1);
  }

  // ---- final ----
  const fa = await server(A);
  const ranked = [...fa.players].sort((a, b) => b.networth - a.networth);
  const listed = await A.$$eval('.final-list > li', lis => lis.map(li => [li.querySelector('.fl-who b').childNodes[0].textContent.trim(), li.querySelector('.fl-total').innerText]));
  assert.deepEqual(listed.map(([n]) => n), ranked.map(p => p.name), 'final order');
  listed.forEach(([, v], i) => assert.equal(cents(num(v)), cents(ranked[i].networth)));
  const title = await A.locator('#r-final h1').innerText();
  const tie = cents(ranked[0].networth) === cents(ranked[1].networth);
  assert.match(title, tie ? /Shared victory/ : new RegExp(`${ranked[0].name} wins`));
  for (const P of [A, B]) {
    assert.equal(await P.locator('#r-refit').count(), 0, 'no round-seven refit');
    const statuses = await P.$$eval('.crew-status', els => els.map(e => e.textContent.trim()));
    assert.ok(statuses.every(s => s === 'Match complete'), `roster: ${statuses}`);
  }
  for (const p of fa.players) for (const k of Object.keys(p.breakdown)) {
    const shown = await A.$$eval('.final-list > li', (lis, [name, label]) => { const li = lis.find(l => l.querySelector('.fl-who b').textContent.includes(name)); const row = [...li.querySelectorAll('.fl-comp div')].find(d => d.querySelector('dt').textContent === label); return row.querySelector('dd').textContent; }, [p.name, { credits: 'Credits', stocks: 'Shares', salvage: 'Cargo', contracts: 'Contracts', fleet: 'Fleet', objective: 'Objective' }[k]]);
    assert.equal(cents(num(shown)), cents(p.breakdown[k]), `${p.name} ${k}`);
  }
  await A.evaluate(() => scrollTo(0, 0)); await shot(A, '16-final-desktop');
  await B.evaluate(() => scrollTo(0, 0)); await shot(B, '17-final-phone');
  await A.click('#tab-ledger'); await A.waitForSelector('#r-ledger'); await shot(A, '18-ledger-desktop');
  log('final', title, JSON.stringify(ranked.map(p => [p.name, p.networth, p.objective])));
  for (const P of [A, B]) log('overflow', JSON.stringify(await overflow(P)));
  log('privacy leaks', leaks.length ? leaks : 'none');
  // The duplicate-name join above is an intentional 400; the browser logs it as a failed resource.
  const expected = errors.filter(e => /Nova console: Failed to load resource: .*status of 400/.test(e));
  const unexpected = errors.filter(e => !expected.includes(e));
  log('page errors', unexpected.length ? unexpected : 'none', `(expected rejections logged: ${expected.length})`);
  assert.equal(leaks.length, 0); assert.equal(unexpected.length, 0); assert.ok(expected.length <= 1);
  require('node:fs').writeFileSync(`${out}/match-results.json`, JSON.stringify({ code, results, final: fa.players.map(p => ({ name: p.name, networth: p.networth, objective: p.objective, breakdown: p.breakdown })) }, null, 1));
  await browser.close();
  log('MATCH PASSED');
})().catch(e => { console.error('FAILED', e); process.exit(1); });
