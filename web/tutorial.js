// The guided practice: short steps that point at the real controls and wait for the player.
// Every number in the text is read from the live game state, so the guide can't drift from the rules.
import {SECTORS, GOODS, money, units, pct, signedMoney} from './model.js';

export const RIVAL = 'Kestrel Haulers';
const READY = ['#ready-dock', '#ready-rail', '#ready-main'];
const REVIEW = ['#review-dock', '#review-rail', '#review-main'];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const p = (...lines) => lines.filter(Boolean).map(l => `<p>${l}</p>`).join('');
const scanOf = (y, j) => y.scans.find(x => x.target === 'hazard' && x.sector === j);
const rivalSeat = s => s.players.findIndex(x => x.seat !== s.you.seat);
const outcome = v => v === 1 ? 'clear' : v === .5 ? 'disrupted' : 'severe';
const lastLog = s => s.history.at(-1);

export const steps = [
  // ---------- round 1 briefing ----------
  {id: 'welcome', round: 1, phase: 'briefing', next: 'Let’s go', title: 'Welcome to your practice match',
    body: ({state: s}) => p(`You run <b>${esc(s.you.name)}</b>, a salvage crew. This guide plays one round with you against <b>${RIVAL}</b>, a training rival with a simple, steady strategy.`,
      'It runs only in this browser and never touches real rooms. Round 1 is set up so you see each kind of site outcome once; after that, outcomes are random, as in a real match.')},
  {id: 'goal', round: 1, phase: 'briefing', target: ['.dock-worth', '.rail .worth'], title: 'Win on net worth',
    body: ({state: s}) => p(`After six rounds, the crew with the highest net worth wins. That’s your credits plus everything you own: shares, cargo, contract score and drones.`,
      `You start with <b>${money(s.you.credits)} cr</b>, ${s.you.fuel} fuel and two drones.`)},
  {id: 'market', round: 1, phase: 'briefing', target: ['.market-cards'], title: 'Salvage moves prices',
    body: ({state: s}) => p(`Each cargo has a price and a posted demand. Crews want <b>${units(s.demand[0])} Alloys</b> this round.`,
      'If all crews together bring back more than that, the Alloy price falls. If they bring back less, it rises. Everyone sells into the same market.')},
  {id: 'sites', round: 1, phase: 'briefing', target: ['#sector-2'], title: 'Richer sites are riskier',
    body: ({state: s}) => p(`The Crystal Belt is safe and cheap to reach. The Void Rift’s Relic Tech sells for <b>${money(s.prices[2])} cr</b> a unit, but the Rift is clear only ${Math.round(s.rules.clear[2] * 100)}% of the time.`,
      'The bar shows each site’s odds: clear gives a full haul, disruption half, and severe nothing, with a drone disabled.')},
  {id: 'scan', round: 1, phase: 'briefing', action: true, optional: true, target: ['#scan-h-2'], title: 'Scout the Rift',
    done: ({state: s}) => !!scanOf(s.you, 2), do: 'Press the highlighted “Scan hazard” button.',
    body: ({state: s}) => p(`Buy a private hazard scan of the Void Rift for ${money(s.you.scanner ? s.rules.upgraded_scan_cost : s.rules.scan_cost)} cr. It shows this round’s actual outcome there, and only you see it.`)},
  {id: 'scan-result', round: 1, phase: 'briefing', target: ['#sector-2 .scan-result'], skip: ({state: s}) => !scanOf(s.you, 2),
    title: ({state: s}) => `The Rift is ${outcome(scanOf(s.you, 2).value)} this round`,
    body: ({state: s}) => { const v = scanOf(s.you, 2).value;
      return v === 0 ? p('Drones sent there this round bring back nothing, and each crew’s lowest-numbered drone there is disabled.', 'That’s what scans are for: keep your drones away from the Rift this round.')
        : v === .5 ? p('Drones sent there this round bring back half a haul. Weigh that against the Belt’s steadier odds.')
        : p('A full haul is waiting there this round, and only you know it.'); }},
  {id: 'ready-1', round: 1, phase: 'briefing', action: true, target: READY, title: 'Ready up',
    done: ({state: s}) => s.you.ready, do: 'Press “Ready for planning”.',
    body: ({state: s}) => p(`Your ${s.you.fuel} fuel covers this round: a Belt trip uses ${s.rules.fuel_use[0]} and a Cruiser trip ${s.rules.fuel_use[1]}.`,
      `Mark yourself ready when you’re done here. Planning opens once every crew is ready${s.players[rivalSeat(s)]?.ready ? `, and ${RIVAL} already is` : ''}.`)},

  // ---------- round 1 planning ----------
  {id: 'plan', round: 1, phase: 'planning', target: ['.jump'], title: 'Plan in secret',
    body: () => p('Now decide where your drones go and what to trade. Rivals see your plan only after every crew has locked, and you can change anything until you lock.', 'Work down the page, top to bottom.')},
  {id: 'drone-1', round: 1, phase: 'planning', action: true, target: ['#chip-0-0'], title: 'Send Drone 1 to the Belt',
    done: ({draft}) => draft.allocation['0'] !== undefined, do: 'Tap the highlighted “Drone 1”.',
    body: ({state: s}) => p(`Tap <b>Drone 1</b> under the Crystal Belt. Each drone you send costs fuel (${s.rules.fuel_use[0]} for the Belt) plus ${money(s.rules.deploy_cost)} cr, and can bring back up to ${units(s.rules.capacity[0])} Alloys.`)},
  {id: 'drone-2', round: 1, phase: 'planning', action: true, optional: true, target: ['#chip-1-1'], title: 'Send Drone 2 to the Cruiser',
    done: ({draft}) => draft.allocation['1'] !== undefined, do: 'Tap the highlighted “Drone 2”.',
    body: ({state: s}) => p(`Power Cores from the Derelict Cruiser sell for <b>${money(s.prices[1])} cr</b> each, and a trip there uses ${s.rules.fuel_use[1]} fuel.`, 'A drone left at port brings back nothing and still loses book value.')},
  {id: 'share', round: 1, phase: 'planning', target: ['#sector-0 .bid'], title: 'Share a site, or bid for it',
    body: ({state: s, draft}) => {
      const scan = scanOf(s.you, 2), rift = Object.values(draft.allocation).includes(2);
      return `${rift && scan && scan.value === 0 ? '<p class="coach-warn">Heads up: a drone is going to the Void Rift, and your scan says it’s severe this round.</p>' : ''}${p(
        'With a bid of 0, crews at the same site split its reserve by drones sent.',
        'A positive bid is sealed. The highest bidder takes the site alone and pays its bid; losing bids are refunded. Leave this at 0 for now.')}`; }},
  {id: 'share-buy', round: 1, phase: 'planning', action: true, optional: true, target: ['#row-shares-0 .order-controls'], title: 'Buy a company share',
    done: ({draft}) => draft.shares[0].side === 'buy' && Number(draft.shares[0].qty) >= 1, do: 'Press “Buy”, then “+”.',
    body: ({state: s}) => p('Trades fill at today’s opening prices, before anyone’s salvage lands.',
      `Ferrum Industries’ profit grows with the Alloys crews recover, so its shares can rise even when the Alloy price falls. Buy 1 share at <b>${money(s.stocks[0])} cr</b>.`)},
  {id: 'estimate', round: 1, phase: 'planning', target: ['#estimate-body'], title: 'Check the estimate',
    body: () => p('This projects new prices and your haul, assuming rivals extract a typical amount.', 'It’s an estimate under the assumptions shown, not a promise: rival plans stay sealed until settlement.')},
  {id: 'lock-1', round: 1, phase: 'planning', action: true, target: ({reviewing}) => reviewing ? ['#lock-plan'] : REVIEW,
    done: ({state: s}) => s.you.locked,
    title: ({reviewing}) => reviewing ? 'Lock it in' : 'Review, then lock',
    do: ({reviewing, ev}) => reviewing ? (ev.valid ? 'Press “Lock plan for round 1”.' : 'Fix the listed issue first.') : 'Press “Review plan”.',
    body: ({reviewing, ev}) => reviewing
      ? p(ev.valid ? 'This lists everything you’re committing and the credits it reserves. Locking is final for this round.' : 'Something needs fixing first. Each link in the list jumps to it.',
        'Settlement runs the moment both crews have locked.')
      : p('Open the review to check your whole plan before you commit to it.')},

  // ---------- round 1 results and refit ----------
  {id: 'result', round: 1, phase: 'upgrade', when: c => !c.seqPlaying, target: ['.seq-live .headline'], title: 'Settled in an instant',
    body: ({state: s}) => p(`Both crews locked, so settlement ran straight away. Your public value changed by <b>${signedMoney(lastLog(s).deltas[s.you.seat])} cr</b>.`,
      'The steps below show exactly where that came from, in the order settlement ran.')},
  {id: 'access', round: 1, phase: 'upgrade', when: c => !c.seqPlaying, target: ['.seq-live .d1'], title: 'Who got access',
    body: ({state: s}) => {
      const log = lastLog(s), me = s.you.seat, rival = rivalSeat(s);
      const at = (seat, j) => Object.values(log.plans[seat].allocation).includes(j);
      const both = [0, 1, 2].filter(j => at(me, j) && at(rival, j) && log.access[j] === null);
      return p(both.length ? `You and ${RIVAL} both went to the ${SECTORS[both[0]]} without bidding, so you split its reserve by drones sent.` : 'Each site shows who went there and who got access.',
        'Had either crew bid, the higher bid would have taken the site alone.'); }},
  {id: 'hazards', round: 1, phase: 'upgrade', when: c => !c.seqPlaying, target: ['.seq-live .d2'], title: 'Hazards decided the haul',
    body: ({state: s}) => { const log = lastLog(s), h = log.hazards.map(outcome), got = log.gains[s.you.seat];
      return p(`The Belt was ${h[0]}, the Cruiser ${h[1]} and the Rift ${h[2]}.`,
        got.some(g => g > 0) ? `You recovered ${got.map((g, j) => g > 0 ? `${units(g)} ${GOODS[j]}` : '').filter(Boolean).join(' and ')}. It’s in your hold now, and you can sell it next round.` : 'You recovered nothing this round.'); }},
  {id: 'prices', round: 1, phase: 'upgrade', when: c => !c.seqPlaying, target: ['.seq-live .d3'], title: 'Then prices moved',
    body: ({state: s}) => {
      const log = lastLog(s), moves = [0, 1, 2].map(j => ({j, r: log.prices[j] / log.opening_prices[j] - 1}));
      const top = moves.reduce((a, b) => Math.abs(b.r) > Math.abs(a.r) ? b : a), j = top.j;
      const scarce = log.extraction[j] < log.demand[j];
      return p(`${GOODS[j]} ${top.r >= 0 ? 'rose' : 'fell'} ${pct(Math.abs(top.r))}: crews brought back ${units(log.extraction[j])} against demand of ${units(log.demand[j])}${scarce ? ', so it was scarce' : ', a glut'}.`,
        'Trading, a pull toward the base price and a sealed event also nudge prices. Share prices follow their company’s profit instead.'); }},
  {id: 'refit', round: 1, phase: 'upgrade', target: ['.refit .shop'], title: 'Refit between rounds',
    body: ({state: s}) => p(`Spend credits on a drone (more haul), a scanner (cheaper scans), insurance (automatic repair after a severe hit) or fuel. You have <b>${money(s.you.credits)} cr</b>.`,
      'Purchases apply next round, and none are required.')},
  {id: 'ready-2', round: 1, phase: 'upgrade', action: true, target: READY, title: 'On to round 2',
    done: ({state: s}) => s.you.ready, do: 'Press “Ready for round 2”.', body: () => p('When you’re done refitting, mark yourself ready. The next round starts once both crews are ready.')},

  // ---------- round 2 ----------
  {id: 'fuel', round: 2, phase: 'briefing', target: ['.fuel-buy'], title: 'Keep the tank topped up',
    body: ({state: s}) => p(`You have <b>${s.you.fuel} fuel</b> left. Every trip uses fuel, so buy more here or at refit for ${money(s.rules.fuel_cost)} cr a unit.`, 'With an empty tank, your drones stay at port.')},
  {id: 'ready-3', round: 2, phase: 'briefing', action: true, target: READY, title: 'Ready when you are',
    done: ({state: s}) => s.you.ready, do: 'Press “Ready for planning”.', body: () => p('New demand, new sealed hazards. Scan if you like, then mark yourself ready.')},
  {id: 'sell', round: 2, phase: 'planning', skip: ({state: s}) => !s.you.inventory.some(q => q > 0),
    target: ({state: s}) => [`#row-cargo-${Math.max(0, s.you.inventory.findIndex(q => q > 0))}`], title: 'Your haul is in the hold',
    body: ({state: s}) => p(`You hold ${s.you.inventory.map((q, j) => q > 0 ? `${units(q)} ${GOODS[j]}` : '').filter(Boolean).join(' and ')}.`,
      'Choose <b>Sell</b> to cash in at the opening price, or keep it: cargo counts toward net worth at the market price either way.')},
  {id: 'contracts', round: 2, phase: 'planning', target: ['#sec-deliveries .contracts'], title: 'Deliveries pay in score',
    body: ({state: s}) => { const r = s.rules, need = r.contract_qty[0], worth = need * s.prices[0], more = r.contract_score[0] > worth;
      return p(`Contracts turn cargo into permanent score. Delivering ${units(need)} Alloys earns <b>+${money(r.contract_score[0])}</b>, ${more ? 'more than' : 'less than'} the ${money(worth)} cr they’d sell for today.`,
        'Each contract pays once and uses up the cargo. Request one when you’ll hold enough after this round’s haul.'); }},
  {id: 'done', round: 2, phase: 'planning', final: true, title: 'You know the loop',
    actions: [['keep', 'Keep playing', true], ['leave', 'Leave practice']],
    body: () => p('Brief, plan, lock, read the result, refit: that’s every round.', `Play out this practice match against ${RIVAL}, or head back to start a real room with friends. You can reopen the guide from the menu.`)},
];
