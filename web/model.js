// Pure presentation logic shared by the browser client and its regression tests.
// Nothing here is authoritative: the server validates and settles every plan.
export const SECTORS = ['Crystal Belt', 'Derelict Cruiser', 'Void Rift'];
export const GOODS = ['Alloys', 'Power Cores', 'Relic Tech'];
export const COMPANIES = ['Ferrum Industries', 'Helion Energy', 'Aether Research'];
export const TICKERS = ['FER', 'HEL', 'AER'];
export const CONTRACTS = ['Hull restoration', 'Reactor restart', 'Archive recovery'];
export const OBJECTIVES = {
  'Industrial Titan': 'Earn 5 cr per Alloy you personally recover.',
  'Market Shark': 'Earn 30% of your positive net share-trading profit, after fees and losses.',
  'Tech Pioneer': 'Earn 20 cr per Relic Tech you personally recover.',
  'Logistics Empire': 'Earn 40 cr per delivery contract you complete.',
};
// [key, short label, explanation]; all six stay visible for your own corporation.
export const COMPONENTS = [
  ['credits', 'Credits', 'Spendable cash.'],
  ['stocks', 'Shares', 'Company shares at current share prices.'],
  ['salvage', 'Cargo', 'Unsold cargo at current cargo prices.'],
  ['contracts', 'Contracts', 'Permanent score from completed deliveries. Not spendable.'],
  ['fleet', 'Fleet', 'Depreciated drone book value; disabled drones count 25%. Not spendable.'],
  ['objective', 'Objective', 'Your private objective bonus so far. Rivals see it only at the end.'],
];
export const PUBLIC_KEYS = COMPONENTS.map(c => c[0]).filter(k => k !== 'objective');

export const cents = n => Math.round(Number(n) * 100);
// Mirrors the frozen economy's half-up cent rounding.
export const round2 = x => Math.floor(x * 100 + 0.500000001) / 100;
export const money = n => Number(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
export const units = n => Number(n).toLocaleString('en-US', {maximumFractionDigits: 3});
export const signedMoney = n => {
  const c = cents(n);
  return c === 0 ? '0.00' : `${c > 0 ? '+' : '−'}${money(Math.abs(c) / 100)}`;
};
export const pct = (n, digits = 1) => {
  const v = Number((Number(n) * 100).toFixed(digits));
  return v === 0 ? `${(0).toFixed(digits)}%` : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`;
};
export const sum = list => list.reduce((a, b) => a + b, 0);

const blank = () => ({side: 'hold', qty: ''});
export function emptyDraft() {
  return {allocation: {}, bids: ['0', '0', '0'], cargo: [blank(), blank(), blank()], shares: [blank(), blank(), blank()], contracts: [false, false, false]};
}

// Converts the server's signed plan format into Buy / Sell / Hold controls.
export function draftFromPlan(plan = {}) {
  const order = v => v > 0 ? {side: 'buy', qty: String(v)} : v < 0 ? {side: 'sell', qty: String(-v)} : blank();
  return {
    allocation: Object.fromEntries(Object.entries(plan.allocation || {}).map(([k, v]) => [String(k), Number(v)])),
    bids: (plan.bids || [0, 0, 0]).map(String),
    cargo: (plan.commodity_orders || [0, 0, 0]).map(order),
    shares: (plan.stock_orders || [0, 0, 0]).map(order),
    contracts: [...(plan.contracts || [false, false, false])],
  };
}

// Accepts a saved control draft or an older signed-plan draft.
export function normalizeDraft(raw) {
  if (!raw || typeof raw !== 'object') return emptyDraft();
  if (Array.isArray(raw.cargo) && Array.isArray(raw.shares)) return {...emptyDraft(), ...raw, allocation: {...(raw.allocation || {})}};
  return draftFromPlan(raw);
}

export function fleetFor(you) {
  return you.recovery ? [{id: -1, value: 0, disabled: false, insured: false, recovery: true}] : you.drones;
}

function parseQty(text, whole) {
  const t = String(text ?? '').trim();
  if (t === '') return {empty: true};
  if (!(whole ? /^\d{1,3}$/ : /^\d{1,3}(\.\d{1,3})?$/).test(t))
    return {error: whole ? 'Shares trade in whole numbers.' : 'Use a number with up to three decimals, like 2 or 1.5.'};
  return {value: Number(t)};
}

// Largest quantity whose fee-inclusive, cent-rounded cost fits the credits left for this order.
export function maxAffordable(price, available, fee, step) {
  if (available <= 0) return 0;
  let q = Math.floor(available / (price * (1 + fee)) / step + 1e-9) * step;
  q = Number(q.toFixed(3));
  while (q > 0 && round2(q * price * (1 + fee)) > available + 1e-8) q = Number((q - step).toFixed(3));
  return Math.max(0, q);
}

// Checks a draft against the frozen v0.2 rules the server enforces at lock, explains each
// problem beside its control, and translates the controls into the signed API plan.
export function evaluate(draft, {you, prices, stocks, rules}) {
  const errors = {}, fee = rules.fee, fleet = fleetFor(you);
  const owned = Object.fromEntries(fleet.map(d => [String(d.id), d]));
  const allocation = {};
  let fuel = 0, deployed = 0;
  for (const [id, sector] of Object.entries(draft.allocation || {})) {
    const d = owned[id];
    if (!d || d.disabled) continue;
    allocation[id] = sector;
    if (id !== '-1') { fuel += rules.fuel_use[sector]; deployed++; }
  }
  const visited = new Set(Object.values(allocation));
  const bids = [0, 0, 0];
  draft.bids.forEach((text, j) => {
    const t = String(text ?? '').trim();
    if (t === '' || t === '0') return;
    const key = `bid-${j}`;
    if (!/^\d{1,4}$/.test(t)) { errors[key] = 'Bids are whole credits.'; return; }
    const b = Number(t);
    bids[j] = b;
    if (you.recovery) errors[key] = 'The recovery drone already has protected access and cannot bid.';
    else if (b < rules.bid_min || b > rules.bid_max) errors[key] = `Bid ${rules.bid_min}–${rules.bid_max} cr, or 0 for no bid.`;
    else if (!visited.has(j)) errors[key] = 'Assign a drone here first. A bid buys access for drones you send.';
  });
  const credits = you.credits, lines = [];
  const orders = {cargo: [0, 0, 0], shares: [0, 0, 0]};
  const costOf = [];
  let buys = 0, sells = 0, fees = 0;
  for (const kind of ['cargo', 'shares']) {
    const whole = kind === 'shares', quotes = whole ? stocks : prices, held = whole ? you.shares : you.inventory;
    draft[kind].forEach((o, j) => {
      if (o.side === 'hold') return;
      const key = `${kind}-${j}`, q = parseQty(o.qty, whole);
      if (q.empty) { errors[key] = `Enter how many to ${o.side}, or choose Hold.`; return; }
      if (q.error) { errors[key] = q.error; return; }
      const v = q.value;
      if (v === 0) { errors[key] = 'Enter a quantity above 0, or choose Hold.'; return; }
      const limit = whole ? rules.stock_trade : rules.commodity_trade[j];
      const cap = whole ? rules.stock_position : rules.commodity_position[j];
      const notional = round2(v * quotes[j]);
      if (o.side === 'buy') {
        if (v > limit + 1e-9) errors[key] = `You can buy up to ${units(limit)} per round.`;
        else if (held[j] + v > cap + 1e-9) errors[key] = `Holding limit is ${cap}. You hold ${units(held[j])}, so you can buy up to ${units(Math.max(0, cap - held[j]))}.`;
        const cost = round2(v * quotes[j] * (1 + fee));
        buys += cost; fees += cost - notional; costOf.push([key, cost]);
        orders[kind][j] = v;
        lines.push({kind, j, side: 'buy', qty: v, price: quotes[j], cash: -cost, fee: round2(cost - notional)});
      } else {
        if (v > limit + 1e-9) errors[key] = `You can sell up to ${units(limit)} per round.`;
        else if (v > held[j] + 1e-9) errors[key] = held[j] > 0
          ? `You hold ${units(held[j])}, so you can sell up to ${units(Math.min(limit, held[j]))}.`
          : 'You hold none to sell. Salvage from this round can be sold next round.';
        const proceeds = round2(v * quotes[j] * (1 - fee));
        sells += proceeds; fees += notional - proceeds;
        orders[kind][j] = -v;
        lines.push({kind, j, side: 'sell', qty: v, price: quotes[j], cash: proceeds, fee: round2(notional - proceeds)});
      }
    });
  }
  const deployment = rules.deploy_cost * deployed;
  const reserved = round2(deployment + sum(bids) + buys);
  if (fuel > you.fuel) errors.fuel = `This plan needs ${fuel} fuel but your tank holds ${you.fuel}. Send fewer drones or choose closer sectors; fuel can be bought at the next briefing.`;
  if (reserved > credits + 1e-8) errors.credits = `This plan reserves ${money(reserved)} cr but you have ${money(credits)} cr. Lower a bid or a buy order. Sale proceeds arrive only after settlement.`;
  const maxima = {};
  for (const kind of ['cargo', 'shares']) {
    const whole = kind === 'shares', quotes = whole ? stocks : prices, held = whole ? you.shares : you.inventory;
    maxima[kind] = [0, 1, 2].map(j => {
      const limit = whole ? rules.stock_trade : rules.commodity_trade[j];
      const cap = whole ? rules.stock_position : rules.commodity_position[j];
      const own = costOf.find(([k]) => k === `${kind}-${j}`)?.[1] || 0;
      const room = Math.max(0, cap - held[j]);
      const afford = maxAffordable(quotes[j], round2(credits - (reserved - own)), fee, whole ? 1 : .001);
      const buy = Number(Math.min(limit, room, afford).toFixed(3));
      const sell = Number(Math.min(limit, Math.floor(held[j] * 1000 + 1e-6) / 1000).toFixed(3));
      const why = afford < Math.min(limit, room) ? 'what you can afford' : room < limit ? 'your holding limit' : 'the per-round limit';
      return {buy: whole ? Math.floor(buy) : buy, sell: whole ? Math.floor(sell) : sell, limit, cap, why};
    });
  }
  const functional = fleet.filter(d => !d.disabled);
  return {
    plan: {
      allocation: Object.fromEntries(Object.entries(allocation).map(([k, v]) => [String(k), v])),
      bids, commodity_orders: orders.cargo, stock_orders: orders.shares,
      contracts: draft.contracts.map((c, j) => !!c && !you.contracts[j]),
    },
    errors, valid: Object.keys(errors).length === 0, lines, maxima,
    totals: {
      deployment, bids: sum(bids), buys: round2(buys), fees: round2(fees), sells: round2(sells), reserved,
      available: round2(credits - reserved), fuel, tank: you.fuel,
      assigned: Object.keys(allocation).length, idle: functional.length - Object.keys(allocation).length,
      disabled: fleet.length - functional.length,
    },
  };
}

// An estimate of an order the player has not finished entering would mislead, so order
// problems pause it. Budget, fuel and bid problems still preview; the server reports them too.
export const blocksEstimate = errors => Object.keys(errors).some(k => k.startsWith('cargo-') || k.startsWith('shares-'));

const PHASE_LABEL = {lobby: 'Lobby', briefing: 'Briefing', planning: 'Planning', upgrade: 'Results & refit', finished: 'Match complete'};
export const phaseLabel = phase => PHASE_LABEL[phase] || phase;

// Settlement is instant on the server; it is listed so the order of events stays visible.
export function timeline(phase, round) {
  const steps = [['briefing', 'Briefing'], ['planning', 'Planning'], ['settlement', 'Settlement'], ['reveal', round >= 6 ? 'Final results' : 'Results & refit']];
  const at = {lobby: -1, briefing: 0, planning: 1, upgrade: 3, finished: 4}[phase];
  return steps.map(([key, label], i) => ({key, label, state: i < at ? 'done' : i === at ? 'current' : 'upcoming'}));
}

export function crewStatus(p, phase) {
  if (phase === 'finished') return {label: 'Match complete', done: true, offline: false};
  const done = phase === 'planning' ? !!p.locked : ['briefing', 'upgrade'].includes(phase) ? !!p.ready : phase === 'lobby';
  const label = {
    lobby: 'In lobby',
    briefing: p.ready ? 'Ready for planning' : 'Reviewing briefing',
    planning: p.locked ? 'Plan locked' : 'Editing plan',
    upgrade: p.ready ? 'Refit ready' : 'Reviewing results',
  }[phase];
  if (!p.online) return {label: done && phase !== 'lobby' ? `Offline · ${label.toLowerCase()}` : 'Offline · seat held', done, offline: true};
  return {label, done, offline: false};
}

export function waitingFor(players, phase) {
  if (!['briefing', 'planning', 'upgrade'].includes(phase)) return [];
  return players.filter(p => !crewStatus(p, phase).done);
}

// Standard competition ranking on exact cents: tied totals share a rank.
export function ranked(players, score = p => p.networth) {
  const sorted = [...players].sort((a, b) => cents(score(b)) - cents(score(a)) || a.seat - b.seat);
  return sorted.map(p => ({...p, rank: sorted.findIndex(q => cents(score(q)) === cents(score(p))) + 1}));
}

// Per-component changes in cents, plus any rounding gap against an authoritative total.
export function reconcile(before, after, keys, total) {
  const parts = keys.map(key => ({key, before: before[key], after: after[key], delta: (cents(after[key]) - cents(before[key])) / 100}));
  const partCents = sum(parts.map(p => cents(p.delta)));
  const totalCents = total === undefined ? partCents : cents(total);
  return {parts, total: totalCents / 100, rounding: (totalCents - partCents) / 100};
}

export const COMMODITY_TERMS = ['Supply vs demand', 'Crew trading', 'Pull toward base price', 'Market event'];
export const STOCK_TERMS = ['Company profit', 'Share orders', 'Pull toward 100'];

// Ranks recorded contributions without claiming one caused the move when several did.
export function drivers(components, labels) {
  const items = components.map((value, i) => ({label: labels[i], value}))
    .filter(x => Math.abs(x.value) >= .0005)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const gross = sum(items.map(x => Math.abs(x.value)));
  let summary;
  if (!items.length) summary = 'No measurable pressure';
  else if (Math.abs(items[0].value) >= .6 * gross) summary = `Mostly ${items[0].label.toLowerCase()}`;
  else summary = `Several drivers; largest were ${items[0].label.toLowerCase()} and ${items[1].label.toLowerCase()}`;
  return {items, summary, raw: sum(components)};
}

export function demandLevel(demand, players, neutral) {
  const m = demand / (players * neutral);
  return m < .9 ? {label: 'Low demand', multiplier: .8} : m > 1.1 ? {label: 'High demand', multiplier: 1.2} : {label: 'Normal demand', multiplier: 1};
}

// One worked example of how extraction moves the supply term, using this round's numbers.
export function supplyExample(demand, reserve, rules, j = 0) {
  const term = q => rules.supply_signal * Math.max(-1, Math.min(1, (demand - q) / demand));
  return {demand, reserve, none: term(0), full: term(reserve)};
}

export const hazardResult = v => v === 1 ? {label: 'Clear', effect: 'full yield', tone: 'pos'}
  : v === .5 ? {label: 'Disruption', effect: 'half yield', tone: 'warn'}
  : {label: 'Severe', effect: 'no yield; one drone per crew there disabled', tone: 'neg'};

export function hazardOdds(rules, j) {
  const clear = rules.clear[j], half = rules.disruption[j];
  return {clear, half, severe: Math.max(0, 1 - clear - half)};
}

// Real recorded quotes only: opening price of round 1, then each settled price.
export function priceSeries(history, key, j) {
  if (!history.length) return [];
  const open = key === 'prices' ? 'opening_prices' : 'opening_stocks';
  return [history[0][open][j], ...history.map(h => h[key][j])];
}
