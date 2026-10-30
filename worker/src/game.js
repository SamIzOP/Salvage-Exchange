// Authoritative orchestration over the economy port; a JavaScript twin of server/game.py.
// tests/worker proves both implementations return identical projections for identical games.
import * as E from './economy.js';
import * as S from './schema.js';

export const OBJECTIVES = ['Industrial Titan', 'Market Shark', 'Tech Pioneer', 'Logistics Empire'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const require = (ok, message, status = 400) => { if (!ok) throw new GameError(message, status); };
const sum = E.pySum;
const fold = name => name.toUpperCase().toLowerCase();
const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

export async function digest(key) {
  require(typeof key === 'string' && /^[a-f0-9]{64}$/.test(key), 'Invalid rejoin key', 401);
  return sha256(key);
}

// Cryptographic randomness with the same call shapes as Python's random.SystemRandom.
const unit = () => { const a = new Uint32Array(2); crypto.getRandomValues(a); return (a[0] * 2 ** 21 + (a[1] >>> 11)) / 2 ** 53; };
export const systemRng = {
  choice: seq => seq[Math.floor(unit() * seq.length)],
  choices(population, weights) {
    let x = unit() * sum(weights);
    for (let i = 0; i < population.length; i++) { x -= weights[i]; if (x < 0) return [population[i]]; }
    return [population[weights.map(w => w > 0).lastIndexOf(true)]];
  },
  sample(population, k) {
    const pool = [...population];
    for (let i = 0; i < k; i++) { const j = i + Math.floor(unit() * (pool.length - i)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, k);
  },
};
const roomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => CODE_ALPHABET[b & 31]).join('');

// Own-property access so request IDs such as "__proto__" stay plain data.
const receiptOf = (receipts, id) => Object.hasOwn(receipts, id) ? receipts[id] : undefined;
const setReceipt = (receipts, id, value) => Object.defineProperty(receipts, id, {value, enumerable: true, writable: true, configurable: true});

export function priceAudit(old, rawReturn, floor, ceiling) {
  const capped = E.clamp(rawReturn, -.25, .25);
  const rounded = E.money(old * (1 + capped));
  const lower = Math.max(floor, Math.ceil(old * .75 * 100 - 1e-7) / 100);
  const upper = Math.min(ceiling, Math.floor(old * 1.25 * 100 + 1e-7) / 100);
  const final = E.boundedPrice(old, rawReturn, floor, ceiling);
  return {raw_return: rawReturn, capped_return: capped, rounded_quote: rounded, lower, upper, price: final,
    return_clipped: capped !== rawReturn, quote_clipped: rounded !== final};
}

const MAX_ATTEMPTS = 8;

export class GameService {
  constructor(store, rules, {rng = systemRng, clock = () => Date.now() / 1000, code = roomCode} = {}) {
    Object.assign(this, {store, rules, rng, clock, code});
  }

  member(name) {
    return {name, player: E.newPlayer(this.rules), ready: false, locked: false, plan: null, scans: [], receipts: {},
      seen: this.clock(), public_score: 1270, public_fleet: 2};
  }

  async create(name, key) {
    const identity = S.identity({name, rejoin_key: key});
    const hashed = await digest(key);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const previous = await this.store.member(hashed);
      if (previous) return this.project(await this.store.load(previous.code), previous.seat);
      let code;
      do { code = this.code(); } while (await this.store.load(code));
      const r = this.rules;
      const room = {code, phase: 'lobby', round: 0, version: 1, prices: [...r.base], stocks: [100, 100, 100], demand: [0, 0, 0],
        members: [this.member(identity.name)], history: [], rev: crypto.randomUUID()};
      if (await this.store.create(room, hashed)) return this.project(room, 0);
    }
    throw new GameError('The server is busy. Try again.', 503);
  }

  async join(code, name, key) {
    const identity = S.identity({name, rejoin_key: key});
    const hashed = await digest(key);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const room = await this.store.load(code);
      require(room !== null, 'Room not found', 404);
      const previous = await this.store.member(hashed);
      if (previous) {
        require(previous.code === code, 'This key belongs to another room', 403);
        return this.project(room, previous.seat);
      }
      require(room.phase === 'lobby', 'Match already started; use your saved rejoin key', 409);
      require(room.members.length < 4, 'Room is full', 409);
      require(!room.members.some(m => fold(m.name) === fold(identity.name)), 'Corporation name already in use');
      const seat = room.members.length;
      room.members.push(this.member(identity.name));
      room.version += 1;
      if (await this.commit(room, {digest: hashed, seat})) return this.project(room, seat);
    }
    throw new GameError('The server is busy. Try again.', 503);
  }

  async commit(room, joining) {
    const previous = room.rev ?? '';
    room.rev = crypto.randomUUID();
    return this.store.commit(room.code, previous, room, joining);
  }

  async authorized(code, key) {
    const match = await this.store.member(await digest(key));
    require(match && match.code === code, 'Rejoin key does not authorize this room', 401);
    const room = await this.store.load(code);
    require(room !== null, 'Room not found', 404);
    return {room, seat: match.seat};
  }

  async view(code, key) {
    const {room, seat} = await this.authorized(code, key);
    await this.store.touch(code, seat, this.clock());
    return this.project(room, seat);
  }

  async project(room, seat) {
    const presence = await this.store.presence(room.code);
    const now = this.clock(), r = this.rules, m = room.members[seat], p = m.player;
    const you = {credits: p.credits, fuel: p.fuel, drones: p.drones, inventory: p.inventory, shares: p.shares,
      extracted: p.extracted, contracts: p.contracts, scanner: p.scanner,
      name: m.name, seat, ready: m.ready, locked: m.locked, plan: m.plan, scans: m.scans, reports: m.reports ?? [],
      objective: room.round ? OBJECTIVES[p.objective] : null,
      breakdown: E.breakdown(p, room.prices, room.stocks, r), recovery: E.recoveryEligible(p, room.prices, room.stocks, r)};
    const players = room.members.map((member, i) => {
      const seen = Math.max(member.seen, presence[i] ?? 0);
      const pub = {seat: i, name: member.name, host: i === 0, ready: member.ready, locked: member.locked,
        online: now - seen < 20, networth: member.public_score, fleet: member.public_fleet};
      if (room.phase === 'finished') {
        Object.assign(pub, {objective: OBJECTIVES[member.player.objective], breakdown: E.breakdown(member.player, room.prices, room.stocks, r)});
        pub.networth = E.networth(member.player, room.prices, room.stocks, r);
      }
      return pub;
    });
    return structuredClone({code: room.code, phase: room.phase, round: room.round, version: room.version, prices: room.prices,
      stocks: room.stocks, demand: room.demand, you, rules: r, history: room.history, players});
  }

  prepareRound(room) {
    const r = this.rules, n = room.members.length;
    room.round += 1;
    room.phase = 'briefing';
    room.demand = [0, 1, 2].map(j => n * r.demand[j] * this.rng.choices([.8, 1, 1.2], [1, 2, 1])[0]);
    room.hazards = [0, 1, 2].map(j => this.rng.choices([1, .5, 0], [r.clear[j], r.disruption[j], Math.max(0, 1 - r.clear[j] - r.disruption[j])])[0]);
    room.events = [0, 1, 2].map(() => this.rng.choices([-.08, 0, .08], [1, 3, 1])[0]);
    for (const m of room.members) Object.assign(m, {ready: false, locked: false, plan: null, scans: []});
  }

  async command(code, key, raw) {
    let cmd;
    try { cmd = S.command(raw); } catch { throw new GameError('Invalid action or unavailable drone'); }
    const fingerprint = await sha256(S.fingerprintText(cmd));
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const {room, seat} = await this.authorized(code, key);
      const m = room.members[seat];
      const receipt = receiptOf(m.receipts, cmd.request_id);
      if (receipt !== undefined) {
        require(receipt === fingerprint, 'Request ID already used for a different action', 409);
        return this.project(room, seat);
      }
      require(room.round === cmd.round && room.phase === cmd.phase, 'The phase changed. Refresh and try again.', 409);
      require(room.phase !== 'finished', 'Match is complete', 409);
      require(Object.keys(m.receipts).length < 2000, 'Action limit reached', 429);
      try {
        this.apply(room, seat, m, cmd);
      } catch (err) {
        if (err instanceof GameError) throw err;
        if (err instanceof E.EconomyError) throw new GameError(err.message);
        if (err instanceof E.MissingDrone || err instanceof S.SchemaError) throw new GameError('Invalid action or unavailable drone');
        throw err;
      }
      setReceipt(m.receipts, cmd.request_id, fingerprint);
      m.seen = this.clock();
      room.version += 1;
      if (await this.commit(room)) return this.project(room, seat);
    }
    throw new GameError('The server is busy. Try again.', 503);
  }

  apply(room, seat, m, cmd) {
    const r = this.rules;
    if (cmd.kind === 'start') {
      require(seat === 0 && room.phase === 'lobby', 'Only the host can start from the lobby', 403);
      require(room.members.length >= 2 && room.members.length <= 4, 'At least two corporations are required');
      const objectives = this.rng.sample([0, 1, 2, 3], room.members.length);
      room.members.forEach((member, i) => { member.player.objective = objectives[i]; });
      this.prepareRound(room);
    } else if (cmd.kind === 'ready') {
      require(['briefing', 'upgrade'].includes(room.phase), 'Not an acknowledgement phase', 409);
      require(!m.ready, 'Already ready', 409);
      m.ready = true;
      if (room.members.every(x => x.ready)) {
        if (room.phase === 'briefing') {
          room.phase = 'planning';
          for (const member of room.members) member.ready = false;
        } else this.prepareRound(room);
      }
    } else if (cmd.kind === 'lock') {
      require(room.phase === 'planning' && !m.locked, 'Plan cannot be changed in this phase', 409);
      require(cmd.plan !== null, 'A plan is required');
      E.validate(m.player, S.planForEconomy(cmd.plan), room.prices, room.stocks, r);
      Object.assign(m, {plan: S.planDump(cmd.plan), locked: true});
      if (room.members.every(x => x.locked)) this.resolve(room);
    } else {
      require(!m.ready && !m.locked, 'Already committed; wait for the next phase', 409);
      const p = m.player;
      if (cmd.kind === 'scan') {
        require(room.phase === 'briefing', 'Scans are purchased during briefing', 409);
        const knowledge = new Map(m.scans.map(x => [`${x.target}:${x.sector}`, [x.target, x.sector, x.value]]));
        E.scan(p, [cmd.target, cmd.sector], room.hazards, room.events, knowledge, r);
        m.scans = [...knowledge.values()].map(([target, sector, value]) => ({target, sector, value}));
      } else if (cmd.kind === 'purchase') this.purchase(room, p, cmd);
    }
  }

  purchase(room, p, cmd) {
    const r = this.rules;
    require(['briefing', 'upgrade'].includes(room.phase), 'Purchases are closed', 409);
    if (room.phase === 'briefing' && cmd.item !== 'fuel') {
      require(['repair', 'drone'].includes(cmd.item) && !p.drones.some(d => !d.disabled), 'Only recovery repairs or replacement are allowed in briefing');
      require(cmd.item !== 'drone' || !p.drones.length, 'Repair your disabled fleet first');
      const cost = cmd.item === 'repair' ? r.repair_cost : r.drone_cost;
      require(p.credits >= cost + r.deploy_cost + (p.fuel ? 0 : r.fuel_cost), 'Recovery purchase must leave enough credits for a Belt launch');
    }
    if (cmd.item === 'fuel') E.buyFuel(p, cmd.quantity, r);
    else if (cmd.item === 'drone') E.buyDrone(p, r);
    else if (cmd.item === 'repair') E.repair(p, cmd.drone_id, r);
    else if (cmd.item === 'insurance') E.insure(p, cmd.drone_id, r);
    else if (cmd.item === 'scanner') {
      require(!p.scanner && p.credits >= r.scanner_cost, 'Scanner unavailable or insufficient credits');
      p.credits = E.money(p.credits - r.scanner_cost);
      p.scanner = true;
    } else if (cmd.item === 'retire') {
      require(p.drones.some(d => d.id === cmd.drone_id), 'Drone not found');
      p.drones = p.drones.filter(d => d.id !== cmd.drone_id);
    } else throw new GameError('Choose an upgrade');
  }

  resolve(room) {
    const r = this.rules;
    const players = room.members.map(m => m.player);
    const plans = room.members.map(m => S.planForEconomy(m.plan));
    const before = players.map(p => E.breakdown(p, room.prices, room.stocks, r));
    const fleets = players.map(p => structuredClone(p.drones));
    const contracts = players.map(p => [...p.contracts]);
    const [prices, stocks, log] = E.settle(players, plans, room.prices, room.stocks, room.demand, room.hazards, room.events, this.rng, r);
    Object.assign(log, {round: room.round, opening_prices: room.prices, opening_stocks: room.stocks, prices, stocks, demand: room.demand,
      plans: plans.map(pl => ({allocation: Object.fromEntries(pl.allocation.map(([d, s]) => [String(d), s])), bids: pl.bids,
        commodity_orders: pl.commodity_orders, stock_orders: pl.stock_orders, contracts: pl.contracts})), scores: [], deltas: []});
    log.commodity_audit = [0, 1, 2].map(j => priceAudit(room.prices[j], sum(log.commodity_terms[j]), r.base[j] / 4, r.base[j] * 4));
    log.stock_audit = [0, 1, 2].map(j => priceAudit(room.stocks[j], sum(log.stock_terms[j].components), 25, 400));
    room.members.forEach((m, seat) => {
      const p = players[seat], old = before[seat];
      const current = E.breakdown(p, prices, stocks, r);
      const pub = Object.fromEntries(Object.entries(current).filter(([k]) => k !== 'objective'));
      log.scores.push(pub);
      log.deltas.push(E.money(sum(Object.values(pub)) - sum(Object.entries(old).filter(([k]) => k !== 'objective').map(([, v]) => v))));
      (m.reports ??= []).push(this.report(seat, plans[seat], old, current, fleets[seat], contracts[seat], p, log));
      Object.assign(m, {public_score: E.money(sum(Object.values(pub))), public_fleet: p.drones.length, ready: false, locked: false});
    });
    Object.assign(room, {prices, stocks, phase: room.round === 6 ? 'finished' : 'upgrade'});
    room.history.push(log);
  }

  // The owner's own settlement accounting, restating what settlement did; see server/game.py.
  report(seat, pl, before, after, fleet, contracts, p, log) {
    const r = this.rules, trades = [];
    for (const [kind, orders, quotes] of [['cargo', pl.commodity_orders, log.opening_prices], ['shares', pl.stock_orders, log.opening_stocks]]) {
      orders.forEach((q, j) => {
        if (!q) return;
        const notional = E.money(Math.abs(q) * quotes[j]);
        const cash = q > 0 ? -E.money(q * quotes[j] * (1 + r.fee)) : E.money(-q * quotes[j] * (1 - r.fee));
        trades.push({kind, asset: j, quantity: q, price: quotes[j], notional, fee: E.money(Math.abs(Math.abs(cash) - notional)), cash});
      });
    }
    const normal = pl.allocation.filter(([d]) => d !== -1);
    const insured = new Set(fleet.filter(d => d.insured).map(d => d.id));
    const hits = [];
    for (let j = 0; j < 3; j++) {
      const ids = normal.filter(([, s]) => s === j).map(([d]) => d);
      if (log.hazards[j] === 0 && ids.length && (log.access[j] === null || log.access[j] === seat)) {
        hits.push({drone: Math.min(...ids), sector: j, repaired: insured.has(Math.min(...ids))});
      }
    }
    const weight = disabled => disabled ? .25 : 1;
    const later = new Map(p.drones.map(d => [d.id, d]));
    const depreciation = sum(fleet.map(d => weight(d.disabled) * (d.value - later.get(d.id).value)));
    const disabling = sum(fleet.map(d => (weight(later.get(d.id).disabled) - weight(d.disabled)) * later.get(d.id).value));
    return {round: log.round, before, after, trades, trade_cash: E.money(sum(trades.map(t => t.cash))),
      deployment: E.money(r.deploy_cost * normal.length), fuel: sum(normal.map(([, s]) => r.fuel_use[s])),
      bid_paid: sum([0, 1, 2].filter(j => log.access[j] === seat).map(j => pl.bids[j])),
      hits, contracts: [0, 1, 2].filter(j => p.contracts[j] && !contracts[j]),
      depreciation: E.money(depreciation), disabling: E.money(disabling)};
  }

  async preview(code, key, rawPlan, rivalFactor) {
    let request, pl;
    try {
      request = S.previewInput({plan: rawPlan, rival_factor: rivalFactor});
      pl = S.planForEconomy(request.plan);
    } catch { throw new GameError('Invalid preview inputs'); }
    const {room, seat} = await this.authorized(code, key);
    require(['briefing', 'planning'].includes(room.phase), 'Preview is available before resolution', 409);
    const r = this.rules, m = room.members[seat], p = m.player, n = room.members.length;
    const knowledge = new Map(m.scans.map(x => [`${x.target}:${x.sector}`, x.value]));
    const desired = [0, 1, 2].map(j => (n - 1) * r.demand[j] * request.rival_factor);
    const means = [0, 1, 2].map(j => r.clear[j] + .5 * r.disruption[j]);
    const hazard = [0, 1, 2].map(j => knowledge.has(`hazard:${j}`) ? knowledge.get(`hazard:${j}`) : means[j]);
    const events = [0, 1, 2].map(j => knowledge.has(`event:${j}`) ? knowledge.get(`event:${j}`) : 0);
    const emergencySector = pl.allocation.find(([d]) => d === -1)?.[1];
    const scenarios = ['shared', 'access_won', 'access_lost'].map(mode => {
      const own = [], rivals = [];
      for (let j = 0; j < 3; j++) {
        const emergency = emergencySector === j;
        const cap = sum(pl.allocation.filter(([, s]) => s === j).map(([d]) => r.capacity[j] * (d === -1 ? .5 : 1)));
        const rival = desired[j] / means[j];
        const reserve = n * r.reserve[j];
        const available = reserve - (emergency ? cap : 0);
        const total = cap + rival;
        let mine, others;
        if (emergency) [mine, others] = [cap, Math.min(rival, available)];
        else if (pl.bids[j] && mode === 'access_won') [mine, others] = [Math.min(cap, reserve), 0];
        else if (pl.bids[j] && mode === 'access_lost') [mine, others] = [0, Math.min(rival, reserve)];
        else {
          mine = total ? Math.min(cap, reserve * cap / total) : 0;
          others = total ? Math.min(rival, reserve * rival / total) : 0;
        }
        own.push(E.cargo(mine * hazard[j]));
        rivals.push(E.cargo(others * hazard[j]));
      }
      const supply = own.map((a, j) => a + rivals[j]);
      const [prices, terms] = E.commodityUpdate(room.prices, supply, pl.commodity_orders, room.demand, events, r);
      const [stocks] = E.stockUpdate(room.stocks, prices, supply, pl.stock_orders, n, r);
      return {mode, personal: own, rival_supply: rivals, total_supply: supply, projected_prices: prices, projected_stocks: stocks, terms,
        salvage_value: own.map((a, j) => E.money(a * prices[j]))};
    });
    let error = null, fuel = 0, reserved = 0;
    try { [fuel, reserved] = E.validate(p, pl, room.prices, room.stocks, r); }
    catch (err) { if (!(err instanceof E.EconomyError)) throw err; error = err.message; }
    return {...scenarios[0], scenarios, estimate: true, error, fuel, reserved,
      contract_cost: r.contract_qty.map((q, j) => E.money(q * room.prices[j]))};
  }
}
