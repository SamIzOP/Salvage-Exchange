// Interaction-state checks in isolated rooms. Fixtures only set up the room; every check uses the browser UI.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { chromium, openAs, BASE, cmd, PYTHON } = require('./lib.cjs');
const out = process.argv[2];
const fixture = (phase, names = []) => JSON.parse(execFileSync(PYTHON, [__dirname + '/fixture.py', process.env.SX_DB, phase, ...names]));
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL', name, '-', e.message.split('\n')[0]); }
};
const active = page => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);

(async () => {
  const browser = await chromium.launch();
  const desktop = { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' };

  await check('editing survives another crew locking (focus, caret, value, disclosure, scroll)', async () => {
    const r = fixture('planning');
    const { page } = await openAs(browser, { code: r.code, ...r.players[0] }, desktop);
    await page.waitForSelector('#r-plan');
    await page.click('#r-plan details[data-key="bid-help-1"] summary');
    await page.click('#side-cargo-0-buy');
    await page.click('#qty-cargo-0');
    await page.keyboard.type('1');
    const scroll = await page.evaluate(() => scrollY);
    await cmd(r.code, r.players[1].key, 'lock', { plan: { allocation: { '0': 0 } } });
    await page.waitForFunction(() => document.querySelector('.crew-list')?.textContent.includes('Plan locked'), null, { timeout: 8000 });
    assert.equal(await active(page), 'qty-cargo-0');
    await page.keyboard.type('.5');
    assert.equal(await page.inputValue('#qty-cargo-0'), '1.5');
    assert.ok(await page.locator('details[data-key="bid-help-1"]').evaluate(d => d.open));
    assert.equal(await page.evaluate(() => scrollY), scroll);
    await page.context().close();
  });

  await check('refresh keeps the draft; rejoin key restores the corporation on another browser', async () => {
    const r = fixture('planning');
    const { page } = await openAs(browser, { code: r.code, ...r.players[0] }, desktop);
    await page.click('#chip-0-2'); await page.fill('#bid-2', '9');
    await page.click('#side-shares-1-buy'); await page.fill('#qty-shares-1', '2');
    await page.reload();
    await page.waitForSelector('#r-plan');
    assert.equal(await page.getAttribute('#chip-0-2', 'aria-pressed'), 'true');
    assert.equal(await page.inputValue('#bid-2'), '9');
    assert.equal(await page.getAttribute('#side-shares-1-buy', 'aria-pressed'), 'true');
    assert.equal(await page.inputValue('#qty-shares-1'), '2');
    const other = await (await browser.newContext(desktop)).newPage();
    await other.goto(BASE + '/');
    await other.click('summary:has-text("Restore your corporation")');
    await other.fill('#rejoin-code', r.code); await other.fill('#rejoin-key', 'f'.repeat(64));
    await other.click('#rejoin-submit');
    await other.waitForSelector('#err-rejoin:not([hidden])');
    assert.match(await other.locator('#err-rejoin').innerText(), /doesn’t open this room/);
    await other.fill('#rejoin-key', r.players[0].key);
    await other.click('#rejoin-submit');
    await other.waitForSelector('#r-plan');
    assert.match(await other.locator('.crew.me .crew-name').innerText(), /Orion Salvage/);
    await page.context().close(); await other.context().close();
  });

  await check('slow lock shows sending state, never a premature success', async () => {
    const r = fixture('planning');
    const { page } = await openAs(browser, { code: r.code, ...r.players[0] }, desktop);
    await page.click('#chip-0-0');
    await page.route('**/commands', async route => { await new Promise(res => setTimeout(res, 2500)); await route.continue(); });
    await page.click('#review-rail'); await page.click('#lock-plan');
    await page.waitForSelector('.banner.info >> text=Sending: lock plan');
    assert.equal(await page.locator('#r-locked').count(), 0, 'no locked view while unconfirmed');
    assert.ok(await page.locator('#plan-form').evaluate(f => f.inert), 'plan inert while lock in flight');
    await page.screenshot({ path: `${out}/state-lock-sending.png` });
    await page.waitForSelector('#r-locked', { timeout: 8000 });
    await page.context().close();
  });

  await check('lost response: retry is safe and charges once', async () => {
    const r = fixture('briefing');
    const { page } = await openAs(browser, { code: r.code, ...r.players[0] }, desktop);
    await page.waitForSelector('#buy-fuel');
    let dropped = false;
    await page.route('**/commands', async route => {
      if (dropped) return route.continue();
      dropped = true;
      await route.fetch();           // the server applies the purchase…
      await route.abort('failed');   // …but the browser never hears back
    });
    await page.fill('#fuel-qty', '3');
    await page.click('#buy-fuel');
    await page.waitForSelector('.banner.warn >> text=Not confirmed: buy fuel');
    await page.screenshot({ path: `${out}/state-not-confirmed.png` });
    assert.ok(await page.locator('#buy-fuel').isDisabled(), 'new purchases blocked until resolved');
    await page.click('#retry');
    await page.waitForSelector('.banner.warn', { state: 'detached' });
    const st = await page.evaluate(async () => { const a = JSON.parse(localStorage.getItem('sx-active')); return (await fetch(`/api/rooms/${a.code}`, { headers: { Authorization: `Bearer ${a.key}` } })).json(); });
    assert.equal(st.you.fuel, 11); assert.equal(st.you.credits, 726);
    await page.context().close();
  });

  await check('insufficient credits and fuel are explained beside controls and block locking', async () => {
    const r = fixture('lowfuel');
    const { page } = await openAs(browser, { code: r.code, ...r.players[0] }, desktop);
    await page.click('#chip-0-2');
    await page.waitForSelector('#err-fuel:not([hidden])');
    assert.match(await page.locator('#err-fuel').innerText(), /needs 3 fuel but your tank holds 2/);
    for (const j of [0, 1, 2]) { await page.click(`#side-shares-${j}-buy`); await page.fill(`#qty-shares-${j}`, '2'); }
    await page.fill('#bid-2', '120');
    await page.click('#side-cargo-2-buy'); await page.fill('#qty-cargo-2', '1');
    await page.waitForSelector('#err-credits:not([hidden])');
    assert.match(await page.locator('#err-credits').innerText(), /reserves 811\.44 cr but you have 750\.00 cr/);
    await page.click('#side-cargo-0-buy'); await page.fill('#qty-cargo-0', '5');
    assert.match(await page.locator('#err-cargo-0').innerText(), /up to 4 per round/);
    assert.equal(await page.inputValue('#qty-cargo-0'), '5', 'quantity not silently changed');
    assert.ok(await page.locator('#max-cargo-0').isDisabled(), 'Max is unavailable when nothing more is affordable');
    assert.match(await page.locator('#limit-cargo-0').innerText(), /up to 0 now, set by what you can afford/);
    await page.click('#review-rail');
    assert.ok(await page.locator('#lock-plan').isDisabled());
    assert.match(await page.locator('#dialog .issues').innerText(), /Fuel/);
    assert.match(await page.locator('#dialog .issues').innerText(), /up to 4 per round/);
    await page.screenshot({ path: `${out}/state-review-blocked.png` });
    await page.click('#dialog .issues button:has-text("Fuel")');
    assert.equal(await page.locator('#dialog').evaluate(d => d.open), false);
    await page.context().close();
  });

  await check('disabled drone: reveal explains it, refit offers repair, planning shows it unavailable', async () => {
    const r = fixture('disabled');
    const { page } = await openAs(browser, { code: r.code, ...r.players[0] }, desktop);
    await page.waitForSelector('#r-reveal');
    assert.match(await page.locator('#r-reveal').innerText(), /Drone 1 was disabled in the Crystal Belt/);
    assert.ok(await page.locator('#repair-0').count());
    await page.click('#ready-main');
    await cmd(r.code, r.players[1].key, 'ready');
    await page.waitForSelector('#r-brief');
    await page.click('#ready-main');
    await cmd(r.code, r.players[1].key, 'ready');
    await page.waitForSelector('#r-plan');
    assert.ok(await page.locator('#chip-0-0').isDisabled());
    assert.match(await page.locator('ul.fleet').innerText(), /Disabled · repair at refit/);
    await page.context().close();
  });

  await check('recovery drone is Belt-only, protected, and cannot bid', async () => {
    const r = fixture('recovery');
    const { page } = await openAs(browser, { code: r.code, ...r.players[0] }, desktop);
    await page.waitForSelector('#r-brief');
    assert.match(await page.locator('.fleet-note').innerText(), /temporary recovery drone/);
    await page.click('#ready-main'); await cmd(r.code, r.players[1].key, 'ready');
    await page.waitForSelector('#r-plan');
    assert.ok(await page.locator('#chip--1-1').isDisabled());
    assert.ok(await page.locator('#bid-0').isDisabled());
    await page.click('#chip--1-0');
    await page.click('#review-rail'); await page.click('#lock-plan');
    await page.waitForSelector('#r-locked');
    await page.context().close();
  });

  await check('keyboard-only planning, focus return, menu escape', async () => {
    const r = fixture('planning');
    const { page } = await openAs(browser, { code: r.code, ...r.players[0] }, desktop);
    await page.waitForSelector('#r-plan');
    const tabTo = async id => { for (let i = 0; i < 160; i++) { if ((await active(page)) === id) return; await page.keyboard.press('Tab'); } throw new Error(`could not tab to ${id}`); };
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'skip');
    await page.keyboard.press('Enter');
    await tabTo('chip-0-0'); await page.keyboard.press('Space');
    assert.equal(await page.getAttribute('#chip-0-0', 'aria-pressed'), 'true');
    assert.ok(await page.evaluate(() => document.activeElement.matches(':focus-visible')));
    await tabTo('side-cargo-0-buy'); await page.keyboard.press('Enter');
    await tabTo('qty-cargo-0'); await page.keyboard.type('2');
    await tabTo('review-main'); await page.keyboard.press('Enter');
    await page.waitForSelector('#dialog[open]');
    await page.keyboard.press('Escape');
    assert.equal(await active(page), 'review-main', 'focus returns to opener');
    await page.keyboard.press('Enter');
    await tabTo('lock-plan'); await page.keyboard.press('Enter');
    await page.waitForSelector('#r-locked');
    const st = await page.evaluate(async () => { const a = JSON.parse(localStorage.getItem('sx-active')); return (await fetch(`/api/rooms/${a.code}`, { headers: { Authorization: `Bearer ${a.key}` } })).json(); });
    assert.deepEqual(st.you.plan.allocation, { '0': 0 }); assert.deepEqual(st.you.plan.commodity_orders, [2, 0, 0]);
    await page.focus('#menu-toggle'); await page.keyboard.press('Enter');
    await page.waitForSelector('#menu.open');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#menu.open').count(), 0);
    assert.equal(await active(page), 'menu-toggle');
    await page.context().close();
  });

  await check('connection loss shows reconnecting, then recovers without losing the draft', async () => {
    const r = fixture('planning');
    const { page } = await openAs(browser, { code: r.code, ...r.players[0] }, desktop);
    await page.click('#chip-1-1');
    await page.route(`**/api/rooms/${r.code}`, route => route.abort('internetdisconnected'));
    await page.waitForSelector('.banner.warn >> text=Reconnecting', { timeout: 8000 });
    assert.match(await page.locator('.conn').innerText(), /Reconnecting/);
    await page.screenshot({ path: `${out}/state-reconnecting.png` });
    await page.unroute(`**/api/rooms/${r.code}`);
    await page.waitForSelector('.banner.warn', { state: 'detached', timeout: 8000 });
    assert.equal(await page.getAttribute('#chip-1-1', 'aria-pressed'), 'true');
    await page.context().close();
  });

  await check('missing room and wrong key give clear recovery states', async () => {
    const { page } = await openAs(browser, { code: 'ZZZZZZ', key: 'a'.repeat(64), name: 'Ghost' }, desktop);
    await page.waitForSelector('.entry .banner.error');
    assert.match(await page.locator('.entry .banner.error').innerText(), /Couldn’t reopen room ZZZZZZ: the key saved in this browser doesn’t open it, or the room was removed/);
    await page.context().close();
    const r = fixture('lobby');
    const { page: p2 } = await openAs(browser, { code: r.code, key: 'b'.repeat(64), name: 'Imposter' }, desktop);
    await p2.waitForSelector('.entry .banner.error');
    assert.match(await p2.locator('.entry .banner.error').innerText(), /doesn’t open it/);
    assert.ok(await p2.locator('#entry-name').isVisible(), 'start screen remains usable');
    await p2.context().close();
  });

  await check('a private scan never appears in the opponent view', async () => {
    const r = fixture('briefing');
    const { page: a } = await openAs(browser, { code: r.code, ...r.players[0] }, desktop);
    const { page: b } = await openAs(browser, { code: r.code, ...r.players[1] }, { ...desktop, viewport: { width: 375, height: 812 } });
    await a.click('#scan-h-0'); await a.waitForSelector('#sector-0 .scan-result');
    await b.waitForTimeout(2500);
    assert.equal(await b.locator('.scan-result').count(), 0);
    assert.ok(await b.locator('#scan-h-0').count(), 'opponent still sees its own unscanned control');
    await a.context().close(); await b.context().close();
  });

  console.log(`\n${results.filter(r => r[0] === 'PASS').length}/${results.length} state checks passed`);
  await browser.close();
  process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
