// Line-for-line JavaScript port of the parts of simulation/economy.py that the live
// server uses. simulation/economy.py stays the source of truth; tests/worker proves this
// port returns identical numbers. Keep evaluation order identical: floating-point sums
// and cent rounding depend on it.

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const money = x => Math.floor(x * 100 + 0.500000001) / 100;
export const cargo = x => Math.floor(x * 1000 + 0.00000001) / 1000;
// CPython 3.12+ builtin sum() over floats uses Neumaier compensated summation; every place the
// Python reference calls sum() must use this, or results drift in the last bit.
export function pySum(values) {
  let hi = 0, lo = 0;
  for (const x of values) {
    const t = hi + x;
    if (Math.abs(hi) >= Math.abs(x)) lo += (hi - t) + x;
    else lo += (x - t) + hi;
    hi = t;
  }
  return lo && Number.isFinite(lo) ? hi + lo : hi;
}
const sum = pySum;

export class EconomyError extends Error {}
const require = (ok, reason) => { if (!ok) throw new EconomyError(reason); };

export const drone = (id, value) => ({id, value, disabled: false, insured: false});

export const newPlayer = (r) => ({
  policy: 'human', objective: 0, credits: 750, fuel: 8, drones: [drone(0, r.drone_cost), drone(1, r.drone_cost)],
  inventory: [0, 0, 0], shares: [0, 0, 0], extracted: [0, 0, 0], contracts: [false, false, false],
  investment_flow: 0, scanner: false, next_drone_id: 2, scan_spend: 0, bid_spend: 0, deployment_spend: 0, insurance_spend: 0,
});

// Plans keep allocation as [[droneId, sector], ...] in submission order, like a Python dict.
const allocationGet = (plan, id) => { const hit = plan.allocation.find(([d]) => d === id); return hit ? hit[1] : undefined; };
const hasDrone = (plan, id) => plan.allocation.some(([d]) => d === id);

export function objectiveBonus(p, stocks, r) {
  let raw;
  if (p.objective === 0) raw = r.titan_rate * p.extracted[0];
  else if (p.objective === 1) raw = r.shark_rate * Math.max(0, p.investment_flow + sum(p.shares.map((a, j) => a * stocks[j])));
  else if (p.objective === 2) raw = r.pioneer_rate * p.extracted[2];
  else raw = r.logistics_rate * p.contracts.filter(Boolean).length;
  return money(Math.min(r.objective_cap, raw));
}

export function breakdown(p, prices, stocks, r) {
  return {
    credits: p.credits,
    stocks: money(sum(p.shares.map((a, j) => a * stocks[j]))),
    salvage: money(sum(p.inventory.map((a, j) => a * prices[j]))),
    contracts: money(sum(p.contracts.map((done, j) => done ? r.contract_score[j] : null).filter(v => v !== null))),
    fleet: money(sum(p.drones.map(d => d.value * (d.disabled ? .25 : 1)))),
    objective: objectiveBonus(p, stocks, r),
  };
}

export const networth = (p, prices, stocks, r) => money(sum(Object.values(breakdown(p, prices, stocks, r))));

export function recoveryEligible(p, prices, stocks, r) {
  let liquid = p.credits + sum(p.inventory.map((x, j) => x * prices[j])) * (1 - r.fee);
  liquid += sum(p.shares.map((x, j) => x * stocks[j])) * (1 - r.fee);
  const launch = r.deploy_cost + (p.fuel >= 1 ? 0 : r.fuel_cost);
  if (p.drones.some(d => !d.disabled)) return liquid + 1e-8 < launch;
  const restore = p.drones.length ? r.repair_cost : r.drone_cost;
  return liquid + 1e-8 < restore + launch;
}

export function boundedPrice(old, rate, lo, hi) {
  const upper = Math.floor(old * 1.25 * 100 + 1e-7) / 100;
  const lower = Math.ceil(old * .75 * 100 - 1e-7) / 100;
  return clamp(money(old * (1 + clamp(rate, -.25, .25))), Math.max(lo, lower), Math.min(hi, upper));
}

export function commodityUpdate(prices, extraction, nettrade, demand, events, r) {
  const result = [], terms = [];
  prices.forEach((old, j) => {
    const components = [r.supply_signal * clamp((demand[j] - extraction[j]) / demand[j], -1, 1),
      r.trade_signal * clamp(nettrade[j] / demand[j], -1, 1),
      r.commodity_pull * (r.base[j] / old - 1), events[j]];
    result.push(boundedPrice(old, sum(components), r.base[j] / 4, r.base[j] * 4));
    terms.push(components);
  });
  return [result, terms];
}

export function stockUpdate(stocks, prices, extraction, nettrade, n, r) {
  const result = [], terms = [];
  stocks.forEach((old, j) => {
    const output = r.demand[j] + r.company_output_link * extraction[j] / n;
    const profit = output * (prices[j] - r.company_cost[j]) - r.company_fixed[j];
    const baseline = (1 + r.company_output_link) * r.demand[j] * (r.base[j] - r.company_cost[j]) - r.company_fixed[j];
    const components = [r.stock_profit_signal * clamp((profit - baseline) / Math.max(20, Math.abs(baseline)), -1.5, 1.5),
      r.stock_trade_signal * clamp(nettrade[j] / (2 * n), -1, 1),
      r.stock_pull * (100 / old - 1)];
    result.push(boundedPrice(old, sum(components), 25, 400));
    terms.push({output, profit, baseline, components});
  });
  return [result, terms];
}

export function validate(p, plan, prices, stocks, r) {
  require(plan.bids.length === 3 && plan.commodity_orders.length === 3 && plan.stock_orders.length === 3 && plan.contracts.length === 3,
    'invalid order length');
  const emergency = hasDrone(plan, -1);
  const owned = new Map(p.drones.map(d => [d.id, d]));
  require(!emergency || plan.allocation.length === 1, 'recovery drone cannot join normal fleet');
  require(!emergency || recoveryEligible(p, prices, stocks, r), 'ineligible recovery drone');
  require(!emergency || !r.protected_recovery || allocationGet(plan, -1) === 0, 'protected recovery is Belt-only');
  let fuel = 0, spend = 0;
  for (const [id, sector] of plan.allocation) {
    require(Number.isInteger(sector) && sector >= 0 && sector < 3, 'invalid sector');
    if (id !== -1) {
      require(owned.has(id) && !owned.get(id).disabled, 'unavailable drone');
      fuel += r.fuel_use[sector];
      spend += r.deploy_cost;
    }
  }
  const visited = plan.allocation.map(([, s]) => s);
  for (let j = 0; j < 3; j++) {
    const b = plan.bids[j];
    require(Number.isInteger(b) && (b === 0 || (r.bid_min <= b && b <= r.bid_max)), 'invalid bid');
    require(!b || visited.includes(j), 'bid without capacity');
    require(!emergency || b === 0, 'recovery drone cannot bid');
    spend += b;
    for (const [order, limit, held, position, price, isStock] of [
      [plan.commodity_orders[j], r.commodity_trade[j], p.inventory[j], r.commodity_position[j], prices[j], false],
      [plan.stock_orders[j], r.stock_trade, p.shares[j], r.stock_position, stocks[j], true]]) {
      require(typeof order === 'number' && Number.isFinite(order), 'non-finite order');
      require(!isStock || Number.isInteger(order), 'fractional shares');
      require(isStock || Math.abs(order * 1000 - Math.round(order * 1000)) < 1e-6, 'cargo precision');
      require(Math.abs(order) <= limit + 1e-8, 'order limit');
      require(order >= -held - 1e-8, 'short sale');
      require(order <= 0 || held + order <= position + 1e-8, 'position limit');
      if (order > 0) spend += money(order * price * (1 + r.fee));
    }
  }
  require(fuel <= p.fuel, 'insufficient fuel');
  require(money(spend) <= p.credits + 1e-8, 'insufficient reserved credits');
  return [fuel, money(spend)];
}

export function settle(players, plans, prices, stocks, demand, hazards, events, rng, r) {
  const n = players.length;
  const reserved = players.map((p, i) => validate(p, plans[i], prices, stocks, r));
  const netcargo = [0, 0, 0], netstock = [0, 0, 0], extracted = [0, 0, 0];
  const gained = players.map(() => [0, 0, 0]);
  const creditsBefore = sum(players.map(p => p.credits));
  let creditDelta = 0, recoveryCount = 0;
  players.forEach((p, i) => {
    const plan = plans[i], [fuel] = reserved[i];
    p.fuel -= fuel;
    const deployment = r.deploy_cost * plan.allocation.filter(([d]) => d !== -1).length;
    p.credits = money(p.credits - deployment);
    p.deployment_spend += deployment;
    creditDelta -= deployment;
    recoveryCount += hasDrone(plan, -1) ? 1 : 0;
    for (let j = 0; j < 3; j++) {
      for (const [orders, holdings, quote, net, stock] of [[plan.commodity_orders, p.inventory, prices, netcargo, false],
        [plan.stock_orders, p.shares, stocks, netstock, true]]) {
        const q = orders[j];
        const change = q >= 0 ? -money(q * quote[j] * (1 + r.fee)) : money(-q * quote[j] * (1 - r.fee));
        p.credits = money(p.credits + change);
        creditDelta += change;
        holdings[j] = stock ? holdings[j] + q : cargo(holdings[j] + q);
        net[j] += q;
        if (stock) p.investment_flow = money(p.investment_flow + change);
      }
    }
  });
  const access = [];
  for (let j = 0; j < 3; j++) {
    const caps = plans.map(pl => sum(pl.allocation.filter(([, s]) => s === j).map(([d]) => r.capacity[j] * (d === -1 ? .5 : 1))));
    const emergencySeats = plans.map((pl, i) => r.protected_recovery && allocationGet(pl, -1) === j ? i : -1).filter(i => i >= 0);
    const protectedCapacity = sum(emergencySeats.map(i => caps[i]));
    const remainingReserve = n * r.reserve[j] - protectedCapacity;
    const normalCapacity = sum(caps.filter((c, i) => !emergencySeats.includes(i)));
    const bidders = plans.map((pl, i) => pl.bids[j] > 0 ? i : -1).filter(i => i >= 0);
    let winner = null;
    if (bidders.length) {
      const highest = Math.max(...bidders.map(i => plans[i].bids[j]));
      winner = rng.choice(bidders.filter(i => plans[i].bids[j] === highest));
      players[winner].credits = money(players[winner].credits - highest);
      players[winner].bid_spend += highest;
      creditDelta -= highest;
    }
    access.push(winner);
    players.forEach((p, i) => {
      const pl = plans[i];
      if (caps[i] === 0 || (winner !== null && winner !== i && !emergencySeats.includes(i))) return;
      const raw = emergencySeats.includes(i) ? caps[i]
        : Math.min(caps[i], winner !== null ? remainingReserve : remainingReserve * caps[i] / normalCapacity);
      const q = cargo(raw * hazards[j]);
      p.inventory[j] = cargo(p.inventory[j] + q);
      p.extracted[j] = cargo(p.extracted[j] + q);
      extracted[j] += q;
      gained[i][j] = q;
      if (hazards[j] === 0) {
        const ids = pl.allocation.filter(([d, s]) => s === j && d !== -1).map(([d]) => d);
        if (ids.length) p.drones.find(d => d.id === Math.min(...ids)).disabled = true;
      }
    });
  }
  const [newprices, commodityTerms] = commodityUpdate(prices, extracted, netcargo, demand, events, r);
  const [newstocks, stockTerms] = stockUpdate(stocks, newprices, extracted, netstock, n, r);
  players.forEach((p, i) => {
    const pl = plans[i];
    for (let j = 0; j < 3; j++) {
      if (pl.contracts[j] && !p.contracts[j] && p.inventory[j] + 1e-8 >= r.contract_qty[j]) {
        p.inventory[j] = cargo(p.inventory[j] - r.contract_qty[j]);
        p.contracts[j] = true;
      }
    }
    for (const d of p.drones) {
      if (d.insured) d.disabled = false;
      d.insured = false;
      d.value = money(d.value * (1 - r.depreciation));
    }
    if (!(p.credits >= 0 && p.fuel >= 0)) throw new Error('settlement produced a negative balance');
    if (!(p.inventory.every(q => q >= 0) && p.shares.every(q => q >= 0 && q <= r.stock_position))) throw new Error('settlement produced an invalid holding');
  });
  if (!(Math.abs(sum(players.map(p => p.credits)) - creditsBefore - creditDelta) < .001)) throw new Error('credit ledger mismatch');
  for (let j = 0; j < 3; j++) {
    if (!(extracted[j] <= n * r.reserve[j] + 1e-7)) throw new Error('sector reserve exceeded');
    if (!(.75 - 1e-8 <= newprices[j] / prices[j] && newprices[j] / prices[j] <= 1.25 + 1e-8)) throw new Error('price bound exceeded');
    if (!(.75 - 1e-8 <= newstocks[j] / stocks[j] && newstocks[j] / stocks[j] <= 1.25 + 1e-8)) throw new Error('stock bound exceeded');
  }
  return [newprices, newstocks, {extraction: extracted, netcargo, netstock, hazards, events, access, gains: gained,
    allocations: plans.map(pl => pl.allocation.map(([, s]) => s)), bids: plans.map(pl => [...pl.bids]),
    commodity_terms: commodityTerms, stock_terms: stockTerms, recovery: recoveryCount}];
}

// `purchased` is a Map keyed by "kind:sector" holding [kind, sector, value] in purchase order.
export function scan(p, [kind, j], hiddenHazards, hiddenEvents, purchased, r) {
  if (purchased.has(`${kind}:${j}`) || purchased.size >= 2) throw new EconomyError('scan target already bought or scan limit');
  if (!['hazard', 'event'].includes(kind) || ![0, 1, 2].includes(j)) throw new EconomyError('invalid scan target');
  const cost = p.scanner ? r.upgraded_scan_cost : r.scan_cost;
  if (p.credits < cost) throw new EconomyError('unaffordable scan');
  p.credits = money(p.credits - cost);
  p.scan_spend += cost;
  purchased.set(`${kind}:${j}`, [kind, j, (kind === 'hazard' ? hiddenHazards : hiddenEvents)[j]]);
}

export function buyDrone(p, r) {
  if (p.drones.length >= r.fleet_limit || p.credits < r.drone_cost) throw new EconomyError('unavailable drone purchase');
  p.credits = money(p.credits - r.drone_cost);
  p.drones.push(drone(p.next_drone_id, r.drone_cost));
  p.next_drone_id += 1;
}

export function buyFuel(p, qty, r) {
  if (!Number.isInteger(qty) || qty < 0 || p.fuel + qty > 16 || p.credits + 1e-8 < qty * r.fuel_cost) throw new EconomyError('invalid fuel purchase');
  p.credits = money(p.credits - qty * r.fuel_cost);
  p.fuel += qty;
}

// Python's next() raises StopIteration for a missing drone; the server reports that separately.
export class MissingDrone extends Error {}
const findDrone = (p, id) => { const d = p.drones.find(x => x.id === id); if (!d) throw new MissingDrone(); return d; };

export function repair(p, id, r) {
  const d = findDrone(p, id);
  if (!d.disabled || p.credits < r.repair_cost) throw new EconomyError('invalid repair');
  p.credits = money(p.credits - r.repair_cost);
  d.disabled = false;
}

export function insure(p, id, r) {
  const d = findDrone(p, id);
  if (d.insured || d.disabled || p.credits < r.insurance_cost) throw new EconomyError('invalid insurance');
  p.credits = money(p.credits - r.insurance_cost);
  p.insurance_spend += r.insurance_cost;
  d.insured = true;
}
