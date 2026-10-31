// What each training mission asks, how it checks the player's real game state, and how it
// explains the result. Every figure is read from the live state, the plan, or the settled round
// report; nothing is a made-up counterfactual. Guidance is at most two short sentences.
import {SECTORS, GOODS, COMPANIES, CONTRACTS, money, units, pct, signedMoney, sum} from './model.js';
import {RIVAL, SCRIPT} from './missions.js';

export const MENTOR = 'Vale';
const READY = ['#ready-dock', '#ready-rail', '#ready-main'];
const REVIEW = ['#review-dock', '#review-rail', '#review-main'];
const total = b => sum(Object.values(b));
const plural = (n, one, many = `${one}s`) => `${units(n)} ${n === 1 ? one : many}`;
const list = xs => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;
const hazardWord = v => v === 1 ? 'clear' : v === .5 ? 'disrupted' : 'severe';
const odds = (r, j) => `${Math.round(r.clear[j] * 100)}% clear, ${Math.round(Math.max(0, 1 - r.clear[j] - r.disruption[j]) * 100)}% severe`;
const siteList = js => list(js.map(j => `the ${SECTORS[j]}`));

// The plan in force: the locked plan once locked, otherwise the draft being edited.
const planOf = c => c.y.locked && c.y.plan ? c.y.plan : c.ev.plan;
const sentTo = (plan, j) => Object.entries(plan.allocation || {}).filter(([, s]) => s === j).map(([d]) => d);
const locked = c => c.y.locked || ['upgrade', 'finished'].includes(c.phase);
const anySent = plan => Object.keys(plan.allocation || {}).length > 0;
const heldSale = (c, plan) => [0, 1, 2].some(j => (plan.commodity_orders?.[j] ?? 0) < 0 && c.y.inventory[j] > 0);
const droneName = id => Number(id) === -1 ? 'the recovery drone' : `Drone ${Number(id) + 1}`;
const rivalLine = round => {
  const sites = [...new Set(SCRIPT[round].rival)];
  return sites.length === 1 ? `${RIVAL} is sending both drones to the ${SECTORS[sites[0]]}.` : `${RIVAL} is sending one drone each to ${siteList(sites)}.`;
};

// ---------- shared result accounting ----------

// Splits a settled round into what the player can spend, what their assets are worth, and the
// total, from the round report the engine wrote. Fuel is listed separately: it has no score value.
export function accounts(report, log, seat) {
  const b = report.before, a = report.after;
  const parts = [
    ['credits', 'Credits (spendable)', a.credits - b.credits],
    ['salvage', 'Cargo at market price', a.salvage - b.salvage],
    ['stocks', 'Shares at market price', a.stocks - b.stocks],
    ['contracts', 'Contract score', a.contracts - b.contracts],
    ['fleet', 'Fleet book value', a.fleet - b.fleet],
    ['objective', 'Private objective', a.objective - b.objective],
  ];
  const change = total(a) - total(b);
  return {parts, change, before: total(b), after: total(a), hits: report.hits, gains: log.gains[seat], fuel: report.fuel, deployment: report.deployment, depreciation: report.depreciation,
    disabling: report.disabling, trades: report.trades, tradeCash: report.trade_cash, contracts: report.contracts};
}

export function ledgerHtml(acc) {
  return `<table class="ledger-mini"><caption class="sr-only">Where your net worth changed</caption><tbody>
    ${acc.parts.filter(([, , d]) => Math.round(d * 100)).map(([k, label, d]) => `<tr><th scope="row">${label}</th><td class="num ${d > 0 ? 'pos' : 'neg'}">${signedMoney(d)}</td></tr>`).join('')}
    <tr class="sum"><th scope="row">Net worth</th><td class="num ${acc.change >= 0 ? 'pos' : 'neg'}">${signedMoney(acc.change)}</td></tr></tbody></table>
    <p class="hint">Fuel used: ${plural(acc.fuel, 'unit')}. Fuel has no value in net worth; what it cost was paid when you bought it.</p>`;
}

const haulLine = acc => {
  const got = acc.gains.map((g, j) => g > 0 ? `${units(g)} ${GOODS[j]}` : '').filter(Boolean);
  return got.length ? `You recovered ${list(got)}.` : 'Nothing came back this round.';
};

// ---------- the four missions ----------

export const MISSIONS = [
  {
    n: 1, round: 1, title: 'Recover your first cargo',
    goal: 'Send a drone to the Crystal Belt, check what the plan commits, and lock it.',
    intel: () => rivalLine(1),
    steps: [
      {label: 'Read the briefing, then get ready', phase: 'briefing', target: () => READY,
        done: c => c.phase !== 'briefing' || c.y.ready,
        say: () => 'Briefing shows prices, demand and each site’s odds. There’s nothing to buy for this mission, so press Ready for planning.'},
      {label: 'Send a drone to the Crystal Belt', phase: 'planning', target: () => ['#chip-0-0'],
        done: c => sentTo(planOf(c), 0).length > 0,
        say: c => `The Belt is the safest site: ${odds(c.r, 0)}. Tap Drone 1 under the Crystal Belt.`,
        callout: {at: '#sector-0 .chips', text: c => `Each trip here costs ${c.r.fuel_use[0]} fuel and ${money(c.r.deploy_cost)} cr and brings back up to ${units(c.r.capacity[0])} Alloys.`},
        alt: c => { const elsewhere = [1, 2].filter(j => sentTo(planOf(c), j).length);
          return elsewhere.length ? `You’ve sent a drone to ${siteList(elsewhere)} instead (${odds(c.r, elsewhere[0])}). That’s a real option, but this mission asks for the Belt, where a first haul is safest.` : ''; }},
      {label: 'Check what the plan commits', phase: 'planning', target: () => REVIEW,
        done: c => c.flags.reviewed || c.y.locked,
        say: c => `Open Review plan to see the fuel and credits this plan reserves.${c.y.drones.some(d => !d.disabled && planOf(c).allocation?.[String(d.id)] === undefined) ? ' A docked drone loses value too, so you may want to send it as well.' : ''}`},
      {label: 'Lock the plan', phase: 'planning', target: () => ['#lock-plan', ...REVIEW],
        done: c => locked(c),
        say: () => `Locking is final for this round. ${RIVAL} has already locked, so settlement runs straight away.`},
    ],
    complete: c => c.acc && c.acc.gains.some(g => g > 0),
    debrief: c => {
      const a = c.acc, idle = c.y.drones.length - Object.keys(c.log.plans[c.seat].allocation).filter(d => d !== '-1').length;
      const haul = sum(a.gains.map((g, j) => g * c.log.prices[j]));
      return `<p>${haulLine(a)} At the new prices it’s worth <b>${money(haul)} cr</b>, but it isn’t cash until you sell it.</p>
        <p>Against that: ${money(a.deployment)} cr of deployment and <b>${money(a.depreciation)} cr</b> of fleet depreciation, because every drone loses 12% of its book value each round, flying or not.${idle > 0 ? ` ${idle === 1 ? 'One drone' : `${idle} drones`} stayed docked and still lost value.` : ''}</p>
        ${ledgerHtml(a)}`;
    },
    failed: c => c.acc ? 'Nothing came back, so there’s no cargo to learn from yet. Retry the mission and send a drone to the Belt.' : '',
  },
  {
    n: 2, round: 2, title: 'Turn a haul into usable cash',
    goal: 'Sell cargo you already hold, decide what to do with the rest, and settle the round.',
    intel: () => `${rivalLine(2)} The Crystal Belt is yours this round.`,
    needs: c => c.y.inventory.some(q => q > 0),
    missing: 'Your hold is empty, so there’s nothing to sell yet.',
    steps: [
      {label: 'Get ready for planning', phase: 'briefing', target: () => READY,
        done: c => c.phase !== 'briefing' || c.y.ready,
        say: c => `You start this round holding ${list(c.y.inventory.map((q, j) => q > 0 ? `${units(q)} ${GOODS[j]}` : '').filter(Boolean))}. Press Ready for planning when you’ve looked around.`},
      {label: 'Sell cargo you already hold', phase: 'planning',
        target: c => [`#side-cargo-${Math.max(0, c.y.inventory.findIndex(q => q > 0))}-sell`],
        done: c => heldSale(c, planOf(c)),
        say: () => 'Choose Sell on a cargo you hold and set how much. It fills at the opening price, minus a 2% fee.',
        callout: {at: c => `#row-cargo-${Math.max(0, c.y.inventory.findIndex(q => q > 0))}`,
          text: c => `Sale cash arrives after settlement, so it can’t fund buys in this same plan. Whatever you haul this round can only be sold next round.`}},
      {label: 'Decide on the rest, then lock', phase: 'planning', target: () => ['#lock-plan', ...REVIEW],
        done: c => locked(c),
        say: c => { const need = c.r.contract_qty[0], have = c.y.inventory[0];
          return have > 0 && !c.y.contracts[0]
            ? `Hull restoration pays +${money(c.r.contract_score[0])} permanent score for ${units(need)} Alloys, and you hold ${units(have)}. With the Belt free, your drones there could bring back up to ${units(c.r.reserve[0] * 2)} more, so keeping Alloys and requesting it is a real alternative to selling.`
            : 'Selling, holding and delivering are all valid. Review the plan, then lock it.'; }},
    ],
    complete: c => c.acc && c.acc.trades.some(t => t.kind === 'cargo' && t.quantity < 0),
    debrief: c => {
      const a = c.acc, sales = a.trades.filter(t => t.kind === 'cargo' && t.quantity < 0);
      const lines = sales.map(t => `Sold ${units(-t.quantity)} ${GOODS[t.asset]} at ${money(t.price)}: ${money(t.notional)} cr of cargo became <b>${money(t.cash)} cr</b> of cash; the ${money(t.fee)} cr fee is all the sale itself cost you.`);
      const delivered = a.contracts.map(j => `${CONTRACTS[j]} delivered: ${units(c.r.contract_qty[j])} ${GOODS[j]} used up for <b>+${money(c.r.contract_score[j])}</b> permanent score. Score counts toward net worth but can’t be spent.`);
      const asked = c.log.plans[c.seat].contracts.map((x, j) => x && !a.contracts.includes(j) ? `You requested ${CONTRACTS[j]} but held too few ${GOODS[j]} after the haul, so nothing was delivered. You can request it again.` : '').filter(Boolean);
      return `${lines.map(l => `<p>${l}</p>`).join('') || '<p>You didn’t sell anything this round.</p>'}${[...delivered, ...asked].map(l => `<p>${l}</p>`).join('')}
        <p>${haulLine(a)} Cash rises and cargo falls when you sell; your wealth only grows from what you recover, deliver or trade well.</p>${ledgerHtml(a)}`;
    },
    failed: c => c.acc ? 'You kept all your cargo, which is allowed, but this mission is about selling. Retry it to practise a sale, or carry on.' : '',
  },
  {
    n: 3, round: 3, title: 'Read the competition',
    goal: 'Predict what a crowded site does to supply, decide whether a scan is worth it, and choose where to go.',
    intel: () => rivalLine(3),
    needs: c => c.y.drones.some(d => !d.disabled) || c.y.recovery,
    missing: 'You have no working drone to send this round.',
    prompt: {
      question: `${RIVAL} is crowding the Crystal Belt. What will that do to Alloys this round?`,
      options: [
        ['glut', 'More Alloys than crews want: supply pushes the Alloy price down'],
        ['scarce', 'Alloys become scarce, so the price rises'],
        ['none', 'Crowding a site doesn’t affect prices'],
      ],
      feedback: (pick, c) => pick === 'glut'
        ? `Right: crowded crews can bring back more than the ${units(c.s.demand[0])} Alloys wanted, which pushes the supply part of the price down. Trading, the base-price pull and a sealed event can still offset it.`
        : `Not quite: crowded crews can bring back more than the ${units(c.s.demand[0])} Alloys wanted, which pushes the supply part of the price down. Trading, the base-price pull and a sealed event can still offset it.`,
    },
    steps: [
      {label: 'Predict the Belt’s supply', phase: 'briefing', target: () => ['#prompt-0'],
        done: c => !!c.flags.prediction || c.phase !== 'briefing',
        say: () => 'Before you plan, make a call. Choose the answer you think is right.'},
      {label: 'Decide whether a scan is worth 20 cr, then get ready', phase: 'briefing', target: () => READY,
        done: c => c.phase !== 'briefing' || c.y.ready,
        say: () => 'A scan shows one site’s real hazard this round, only to you. It’s worth 20 cr only if it could change where a drone goes.'},
      {label: 'Choose where your drones go', phase: 'planning', target: () => ['#sec-dest'],
        done: c => anySent(planOf(c)),
        say: c => `${RIVAL}’ drones will share the Belt reserve with any of yours that go there. Relic Tech demand is up to ${units(c.s.demand[2])} this round and the Rift needs ${c.r.fuel_use[2]} fuel per drone.`},
      {label: 'Lock the plan', phase: 'planning', target: () => ['#lock-plan', ...REVIEW],
        done: c => locked(c),
        say: () => 'Review the plan, then lock it.'},
    ],
    complete: c => c.acc && !!c.flags.prediction,
    debrief: c => {
      const a = c.acc, log = c.log, t = log.commodity_terms[0], move = log.prices[0] / log.opening_prices[0] - 1;
      const values = a.gains.map((g, j) => g > 0 ? `${units(g)} ${GOODS[j]} worth ${money(g * log.prices[j])}` : '').filter(Boolean);
      const plan = log.plans[c.seat], scans = c.y.scans.filter(x => x.target === 'hazard');
      const scanLines = [];
      for (const sc of scans) {
        const went = sentTo(plan, sc.sector).length > 0, sev = sc.value === 0;
        scanLines.push(sev && !went ? `Your scan of the ${SECTORS[sc.sector]} showed it was severe, and you kept clear: a drone there would have come back empty and disabled.`
          : !sev && went ? `Your scan of the ${SECTORS[sc.sector]} confirmed it was ${hazardWord(sc.value)} before you committed a drone.`
          : sev && went ? `Your scan showed the ${SECTORS[sc.sector]} was severe, and a drone went anyway.`
          : `Your scan of the ${SECTORS[sc.sector]} showed it was ${hazardWord(sc.value)}; no drone went there, so it didn’t change your plan this time.`);
      }
      [0, 1, 2].filter(j => !scans.some(sc => sc.sector === j) && log.hazards[j] === 0 && sentTo(plan, j).length)
        .forEach(j => scanLines.push(`Your drone at the ${SECTORS[j]} hit a severe hazard and was disabled. A scan would have shown it.`));
      if (!scans.length && !scanLines.length) scanLines.push('You didn’t scan, and you didn’t walk into a severe hazard: no information was needed this time.');
      const st = log.stock_terms[0];
      return `<p>${values.length ? `You recovered ${list(values)} at the new prices.` : 'Nothing came back this round.'} Units only matter at the price they sell for.</p>
        <p>Alloys: crews brought back ${units(log.extraction[0])} against demand of ${units(log.demand[0])}, so the supply part of the price moved <b>${pct(t[0], 1)}</b>. With trading ${pct(t[1], 1)}, the base-price pull ${pct(t[2], 1)} and the event ${pct(t[3], 1)}, the Alloy price moved ${pct(move, 1)} overall.</p>
        <p>${scanLines.join(' ')}</p>
        <p>${COMPANIES[0]} earns output × (Alloy price − ${money(c.r.company_cost[0])}) − ${money(c.r.company_fixed[0])}: this round ${units(st.output)} × (${money(log.prices[0])} − ${money(c.r.company_cost[0])}) − ${money(c.r.company_fixed[0])} = ${money(st.profit)}, against a baseline of ${money(st.baseline)}. Its share moved ${pct(log.stocks[0] / log.opening_stocks[0] - 1, 1)}. A share isn’t a guaranteed hedge: it follows profit, not the cargo price alone.</p>
        <p class="hint">Scanning every round, bidding for every site and buying every rising share all cost money. Use them when they change a decision.</p>${ledgerHtml(a)}`;
    },
    failed: c => c.acc && !c.flags.prediction ? 'You skipped the prediction. Retry the mission to make the call before you plan.' : '',
  },
  {
    n: 4, round: 4, title: 'Make your own plan', prepared: true,
    goal: 'End round 4 with a higher net worth than you start it with, and both drones still working.',
    uncertain: 'Not guaranteed: the hazards are already rolled and sealed. Up to two scans can reveal them.',
    intel: () => rivalLine(4),
    needs: c => c.y.drones.filter(d => !d.disabled).length >= 2,
    missing: 'This mission needs two working drones.',
    steps: [
      {label: 'Plan the round your way', phase: 'briefing', done: c => c.phase !== 'briefing' || c.y.ready, say: () => 'No exact instructions this time. Use Hint if you want a nudge.'},
      {label: 'Lock your plan', phase: 'planning', done: c => locked(c), say: () => 'Check the estimate and the review, then lock when you’re satisfied.'},
    ],
    hints: [
      c => `Look before you plan: your tank holds ${c.y.fuel} fuel, you hold ${list(c.y.inventory.map((q, j) => q > 0 ? `${units(q)} ${GOODS[j]}` : '').filter(Boolean)) || 'no cargo'}, and each site shows its odds.`,
      c => `Fuel costs ${money(c.r.fuel_cost)} cr a unit and only briefing and refit sell it. Richer sites pay more, but a severe hazard sends a drone home empty and disabled, and this mission needs both drones working.`,
      c => `For example: buy ${c.r.fuel_use[0] + c.r.fuel_use[1]} fuel, send Drone 1 to the Crystal Belt and Drone 2 to the Derelict Cruiser, and check the estimate before you lock. It’s one reasonable plan, not a guaranteed one.`,
    ],
    complete: c => c.acc && c.flags.startWorth !== undefined && c.acc.after > c.flags.startWorth && c.acc.hits.every(h => h.repaired),
    debrief: c => {
      const a = c.acc, log = c.log, plan = log.plans[c.seat], start = c.flags.startWorth ?? a.before, now = a.after;
      const working = a.hits.every(h => h.repaired), up = now > start;
      const est = c.flags.lockEstimate;
      const where = [0, 1, 2].filter(j => sentTo(plan, j).length);
      const hz = where.map(j => `the ${SECTORS[j]} was ${hazardWord(log.hazards[j])}`);
      const sound = est && est.value > est.deployment && !where.some(j => c.y.scans.some(sc => sc.target === 'hazard' && sc.sector === j && sc.value === 0));
      const spent = start - a.before;
      return `<p>You started round 4 at <b>${money(start)} cr</b> and finished at <b>${money(now)} cr</b> (${signedMoney(now - start)}), with ${working ? 'both drones working' : 'a drone disabled'}. ${up && working ? 'Objective met.' : 'Objective not met.'}</p>
        ${Math.round(spent * 100) > 0 ? `<p>That includes ${money(spent)} cr spent in briefing on fuel and scans, which have no score value; the table below starts after those purchases.</p>` : ''}
        ${where.length ? `<p>Where you went: ${list(hz)}. ${haulLine(a)}</p>` : '<p>No drones flew this round.</p>'}
        ${est ? `<p>When you locked, the estimate valued your haul at about ${money(est.value)} cr against ${money(est.deployment)} cr of deployment, before ${money(a.depreciation)} cr of depreciation that happens either way.${!(up && working) && sound ? ' That was a sound plan; the sealed hazards went against it.' : ''}</p>` : ''}
        ${ledgerHtml(a)}`;
    },
    failed: c => c.acc ? 'Retry the mission from the start of round 4: the same sealed hazards, the same rival plan.' : '',
  },
];

export const missionFor = n => MISSIONS.find(m => m.n === n);
