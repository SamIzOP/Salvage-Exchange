// An offline practice match that runs entirely in this browser. It uses the same engine as the
// Worker server (copied into engine/ by scripts/build.mjs), so practice obeys the real rules.
// Nothing here talks to a server, and practice rooms never mix with real rooms.
import {GameService, GameError} from './engine/game.js';
import {SchemaError, command as commandSchema, previewInput} from './engine/schema.js';
import * as E from './engine/economy.js';
import RULES from './engine/rules.js';
import {RIVAL} from './tutorial.js';
const STORE = 'sx-practice-store', META = 'sx-practice';
const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const keygen = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');

// The GameService store contract, kept in memory and mirrored to this browser's storage.
class LocalStore {
  constructor(data) { this.data = data ?? {rooms: {}, members: {}, presence: {}}; }
  persist() { save(STORE, this.data); }
  async load(code) { const room = this.data.rooms[code]; return room ? structuredClone(room) : null; }
  async member(digest) { return this.data.members[digest] ?? null; }
  async create(room, digest) {
    if (this.data.rooms[room.code] || this.data.members[digest]) return false;
    this.data.rooms[room.code] = structuredClone(room);
    this.data.members[digest] = {code: room.code, seat: 0};
    this.persist();
    return true;
  }
  async commit(code, previous, room, joining) {
    if ((this.data.rooms[code]?.rev ?? '') !== previous) return false;
    this.data.rooms[code] = structuredClone(room);
    if (joining) this.data.members[joining.digest] = {code, seat: joining.seat};
    this.persist();
    return true;
  }
  async touch(code, seat, seen) { (this.data.presence[code] ??= {})[seat] = seen; }
  // The training rival is always at the table.
  async presence(code) { return {...this.data.presence[code], 1: Date.now() / 1000}; }
}

let store = null, service = null, meta = null, timer = 0;
const listeners = new Set();
const notify = () => { for (const fn of listeners) fn(); };
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

function boot() {
  if (service) return;
  meta = read(META);
  store = new LocalStore(meta && read(STORE));
  service = new GameService(store, RULES);
}

export const owns = key => { boot(); return !!meta && meta.key === key; };

export function discard() {
  clearTimeout(timer);
  try { localStorage.removeItem(STORE); localStorage.removeItem(META); } catch {}
  store = service = meta = null;
}

// Round 1 is staged so a first-time player sees each kind of site outcome once; the odds shown
// are still the real ones. From round 2 everything is drawn at random, as in a real match.
function stageFirstRound(room) {
  const r = RULES, n = room.members.length;
  room.demand = [0, 1, 2].map(j => n * r.demand[j]);
  room.hazards = [1, .5, 0];
  room.events = [0, 0, 0];
}

export async function create(name) {
  discard();
  boot();
  const key = keygen(), rivalKey = keygen();
  const v = await service.create(name, key);
  await service.join(v.code, RIVAL, rivalKey);
  meta = {code: v.code, key, rivalKey};
  save(META, meta);
  const lobby = await service.view(v.code, key);
  await service.command(v.code, key, {kind: 'start', request_id: crypto.randomUUID(), round: lobby.round, phase: lobby.phase});
  const room = await store.load(v.code);
  stageFirstRound(room);
  room.rev = crypto.randomUUID();
  store.data.rooms[v.code] = room;
  store.persist();
  rivalSoon();
  return {code: v.code, key};
}

const fail = (message, status) => { const err = new Error(message); err.status = status; throw err; };

// The same routes and errors as the HTTP API, answered locally.
export async function api(path, body, key) {
  boot();
  if (!meta) fail('Practice match not found', 404);
  const match = path.match(/^\/rooms\/([^/]+)(\/commands|\/preview)?$/);
  if (!match) fail('Not Found', 404);
  const code = match[1].toUpperCase();
  try {
    if (!match[2]) return await service.view(code, key);
    if (match[2] === '/commands') {
      commandSchema(structuredClone(body));
      const out = await service.command(code, key, structuredClone(body));
      rivalSoon();
      return out;
    }
    previewInput(structuredClone(body));
    return await service.preview(code, key, body.plan ?? {}, body.rival_factor ?? 1);
  } catch (err) {
    if (err instanceof GameError) fail(err.message, err.status);
    if (err instanceof SchemaError) fail('Invalid request. Check values and permitted fields.', 422);
    throw err;
  }
}

// ---------- training rival ----------

function rivalSoon(delay = 900) {
  clearTimeout(timer);
  timer = setTimeout(() => rivalTurn().catch(() => {}), delay);
}

const cmd = (v, extra) => service.command(meta.code, meta.rivalKey, {request_id: crypto.randomUUID(), round: v.round, phase: v.phase, ...extra});

// A plain, predictable crew: Belt and Cruiser runs, sells what it hauled, delivers when it can.
function rivalPlan(v) {
  const y = v.you, r = v.rules;
  const working = y.drones.filter(d => !d.disabled);
  const allocation = {};
  let fuel = 0, spend = 0;
  working.forEach((d, i) => {
    const j = i % 2;
    if (fuel + r.fuel_use[j] <= y.fuel && spend + r.deploy_cost <= y.credits) { allocation[String(d.id)] = j; fuel += r.fuel_use[j]; spend += r.deploy_cost; }
  });
  if (!working.length && y.recovery) allocation['-1'] = 0;
  const contracts = [0, 1, 2].map(j => !y.contracts[j] && y.inventory[j] >= r.contract_qty[j]);
  const commodity_orders = [0, 1, 2].map(j => contracts[j] ? 0 : -E.cargo(Math.min(y.inventory[j], r.commodity_trade[j])));
  return {allocation, bids: [0, 0, 0], commodity_orders, stock_orders: [0, 0, 0], contracts};
}

async function rivalTurn() {
  if (!meta) return;
  let v = await service.view(meta.code, meta.rivalKey);
  const y = v.you, r = v.rules;
  if (v.phase === 'briefing' && !y.ready) {
    const need = y.drones.filter(d => !d.disabled).length * r.fuel_use[1];
    const qty = Math.min(16 - y.fuel, need - y.fuel, Math.floor((y.credits - 60) / r.fuel_cost));
    if (qty > 0) v = await cmd(v, {kind: 'purchase', item: 'fuel', quantity: qty});
    await cmd(v, {kind: 'ready'});
  } else if (v.phase === 'planning' && !y.locked) {
    let plan = rivalPlan(v);
    try { E.validate(v.you, {...plan, allocation: Object.entries(plan.allocation).map(([d, s]) => [Number(d), s])}, v.prices, v.stocks, r); }
    catch { plan = {}; }
    await cmd(v, {kind: 'lock', plan});
  } else if (v.phase === 'upgrade' && !y.ready) {
    for (const d of y.drones.filter(x => x.disabled)) if (v.you.credits >= r.repair_cost + 120) v = await cmd(v, {kind: 'purchase', item: 'repair', drone_id: d.id});
    if (v.round === 2 && v.you.drones.length < 3 && v.you.credits >= r.drone_cost + 150) v = await cmd(v, {kind: 'purchase', item: 'drone'});
    await cmd(v, {kind: 'ready'});
  } else return;
  notify();
  rivalSoon();
}

// Lets the rival catch up after a reload.
export function wake() { boot(); if (meta) rivalSoon(400); }
