// Four separate browser identities fill a room through the UI, play one round, and inspect the reveal.
const assert = require('node:assert/strict');
const { chromium, BASE, overflow } = require('./lib.cjs');
const out = process.argv[2];
const names = ['Orion Salvage', 'Nova Works', 'Kestrel Deep Recovery Co', 'Vega'];
const sizes = [[1440, 900], [375, 812], [768, 1024], [1024, 768]];

(async () => {
  const browser = await chromium.launch();
  const pages = [];
  for (const [i, name] of names.entries()) {
    const [w, h] = sizes[i];
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', isMobile: w < 1024, hasTouch: w < 1024 });
    const page = await ctx.newPage();
    page.on('pageerror', e => { throw e; });
    await page.goto(BASE + '/' + (i ? `?room=${pages[0].code}` : ''));
    await page.fill('#entry-name', name);
    await page.click('#entry-submit');
    await page.waitForFunction(() => document.body.dataset.phase === 'lobby');
    pages.push({ page, name, code: i ? pages[0].code : (await page.locator('.room-code').innerText()).trim() });
  }
  // A fifth crew is refused with a clear message.
  const extra = await (await browser.newContext({ viewport: { width: 375, height: 812 } })).newPage();
  await extra.goto(`${BASE}/?room=${pages[0].code}`);
  await extra.fill('#entry-name', 'Late Crew');
  await extra.click('#entry-submit');
  await extra.waitForSelector('#err-entry-code:not([hidden])');
  assert.match(await extra.locator('#err-entry-code').innerText(), /already has four crews/);
  const [A] = pages.map(p => p.page);
  await A.waitForFunction(() => document.querySelectorAll('.seat:not(.vacant)').length === 4);
  await A.screenshot({ path: `${out}/four-lobby-1440.png` });
  await A.click('#start-main');
  for (const { page } of pages) { await page.waitForFunction(() => document.body.dataset.phase === 'briefing'); }
  for (const { page } of pages) { await page.locator('#ready-main').click(); }
  for (const { page } of pages) { await page.waitForFunction(() => document.body.dataset.phase === 'planning'); }
  for (const [i, { page }] of pages.entries()) {
    await page.locator(`#chip-0-${i % 3}`).click();
    if (i === 1 || i === 2) await page.fill(`#bid-${i % 3}`, String(10 + i));
    await page.locator('#review-main').click();
    await page.locator('#lock-plan').click();
    if (i < 3) await page.waitForSelector('#r-locked');
  }
  for (const { page } of pages) await page.waitForFunction(() => document.body.dataset.phase === 'upgrade');
  for (const [i, { page }] of pages.entries()) {
    const [w] = sizes[i];
    await page.screenshot({ path: `${out}/four-reveal-${w}.png` });
    const o = await overflow(page);
    console.log(names[i], w, 'overflow', o.scrollWidth > o.clientWidth ? o.offenders : 'none');
  }
  const rows = await A.$$eval('.crew-list .crew', els => els.map(e => e.querySelector('.crew-name').childNodes[0].textContent.trim()));
  assert.equal(rows.length, 4);
  console.log('rail crews:', rows.join(' | '));
  console.log('FOUR PLAYER OK');
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
