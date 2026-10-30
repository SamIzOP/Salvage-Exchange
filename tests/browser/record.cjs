// Records the reveal sequence as the rival's lock settles the round (default motion).
const { chromium, cmd, BASE, fixture } = require('./lib.cjs');
const out = process.argv[2];

(async () => {
  const r = await fixture('locked');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } });
  const [a, b] = r.players;
  await context.addInitScript(([code, key, name]) => {
    localStorage.setItem('sx-active', JSON.stringify({ code, key, generation: 1 }));
    localStorage.setItem('sx-sessions', JSON.stringify({ [code]: { key, name } }));
  }, [r.code, a.key, a.name]);
  const page = await context.newPage();
  await page.goto(BASE + '/');
  await page.waitForSelector('#r-locked');
  await page.waitForTimeout(1200);
  await cmd(r.code, b.key, 'lock', { plan: { allocation: { '0': 2 }, bids: [0, 0, 11] } });
  await page.waitForSelector('.seq-live.playing', { timeout: 6000 });
  const frames = [];
  for (const t of [300, 1200, 2200, 3400]) { await page.waitForTimeout(t - (frames.at(-1) || 0)); frames.push(t); await page.screenshot({ path: `${out}/reveal-frame-${t}ms.png` }); }
  await page.waitForTimeout(1500);
  const video = page.video();
  await context.close();
  console.log('video', await video.path());
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
