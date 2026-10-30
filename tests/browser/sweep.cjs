// Layout sweep: every phase at 375/390/768/1024/1440 and 200% zoom. Reports overflow, sub-12px text,
// small touch targets on narrow layouts, and primary actions hidden behind the fixed dock.
const { chromium, cmd, createRoom, openAs, BASE, PYTHON } = require('./lib.cjs');
const out = process.argv[2];
const sizes = [[375, 812, 1], [390, 844, 1], [768, 1024, 1], [1024, 768, 1], [1440, 900, 1], [720, 450, 2, 'zoom200-1440']];
const empty = { allocation: {}, bids: [0, 0, 0], commodity_orders: [0, 0, 0], stock_orders: [0, 0, 0], contracts: [false, false, false] };
const busy = { allocation: { '0': 0, '1': 2 }, bids: [0, 0, 7], commodity_orders: [1, 0, 0], stock_orders: [1, 0, 0], contracts: [false, false, false] };

const { execFileSync } = require('node:child_process');
const DB = process.env.SX_DB;
function room(phase) {
  const out = execFileSync(PYTHON, [__dirname + '/fixture.py', DB, phase, 'Orion Salvage', 'Nova Works', 'Kestrel Deep Recovery Co']);
  return JSON.parse(out);
}

(async () => {
  const browser = await chromium.launch();
  const phases = ['landing', 'lobby', 'briefing', 'planning', 'locked', 'reveal', 'final', 'ledger'];
  const rooms = {};
  for (const ph of phases) if (ph !== 'landing') rooms[ph] = room(ph === 'ledger' ? 'final' : ph);
  const problems = [];
  for (const [w, h, dsf, label] of sizes) {
    for (const ph of phases) {
      const who = ph === 'landing' ? {} : { code: rooms[ph].code, ...rooms[ph].players[0] };
      const { context, page } = await openAs(browser, who, { viewport: { width: w, height: h }, dsf, reducedMotion: 'reduce', touch: w < 1024, mobile: w < 1024 });
      await page.waitForTimeout(900);
      if (ph === 'ledger') {
        if (await page.locator('#tab-ledger').isVisible()) await page.click('#tab-ledger');
        else { await page.click('#menu-toggle'); await page.click('#menu-ledger'); }
        await page.waitForSelector('#r-ledger');
      }
      const report = await page.evaluate((narrow) => {
        const doc = document.documentElement, res = { overflow: doc.scrollWidth > doc.clientWidth + 1, small: [], targets: [], covered: [] };
        const visible = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden],details:not([open]) > .disclosure-body,dialog:not([open]),.sr-only'); };
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const t = walker.currentNode, el = t.parentElement;
          if (!t.textContent.trim() || !el || !visible(el) || el.closest('svg')) continue;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs < 12) res.small.push(`${el.tagName.toLowerCase()}.${el.className} ${fs}px "${t.textContent.trim().slice(0, 30)}"`);
        }
        if (narrow) for (const el of document.querySelectorAll('button, [role=button], input:not([type=hidden]), summary, .jump a')) {
          if (!visible(el) || el.classList.contains('btn-link')) continue;
          const r = el.getBoundingClientRect();
          if (r.height < 43.5 && !(el.type === 'checkbox' || el.type === 'range')) res.targets.push(`${el.tagName.toLowerCase()}#${el.id || el.className} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        return res;
      }, w < 1024);
      // Every primary action in the main column must be reachable above the dock.
      const ids = await page.$$eval('main .btn-primary, main .review-cta .btn, main .next-step .btn', els => els.map(e => e.id).filter(Boolean));
      for (const id of ids) {
        const hit = await page.evaluate(id => { const el = document.getElementById(id); el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return top === el || el.contains(top); }, id);
        if (!hit) report.covered.push(id);
      }
      const name = `${ph}-${label || w}`;
      if (['planning', 'reveal', 'final', 'briefing'].includes(ph) || w === 375) await page.screenshot({ path: `${out}/${name}.png` });
      const bad = report.overflow || report.small.length || report.targets.length || report.covered.length;
      console.log(bad ? 'ISSUE' : 'ok   ', name.padEnd(24), bad ? JSON.stringify({ o: report.overflow, small: report.small.slice(0, 4), t: report.targets.slice(0, 6), covered: report.covered }) : '');
      if (bad) problems.push(name);
      await context.close();
    }
  }
  console.log('problems:', problems.length, problems.join(' '));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
