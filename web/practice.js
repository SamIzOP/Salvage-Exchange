// An offline practice match that runs entirely in this browser on the same engine as the Workers
// server (web/engine), so practice obeys the real rules. Nothing here talks to a server, and
// practice rooms never mix with real rooms.
//
// Training matches add three things on top of the engine, all local to this browser:
//  - staged rounds: for the mission rounds, the sealed draws (demand, hazards, events) are set to
//    values chosen from the valid outcomes, so each lesson has a known, explainable scenario;
//  - a scripted training rival whose plan for each mission round is announced to the player;
//  - checkpoints and prepared yards, so a mission can be retried or started from a known state.
import {GameService, GameError} from './engine/game.js';
import {SchemaError, command as commandSchema, previewInput} from './engine/schema.js';
import * as E from './engine/economy.js';
import RULES from './engine/rules.js';
import {RIVAL, SCRIPT, CANON, OBJECTIVE_SEATS} from './missions.js';

const STORE = 'sx-practice-store', META = 'sx-practice', POINTS = 'sx-practice-checkpoints';
const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
const forget = key => { try { localStorage.removeItem(key); } catch {} };
const keygen = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
const clone = v => structuredClone(v);

// The GameService store contract, kept in memory and mirrored to this browser's storage. If
// storage fails (private mode, quota), the match keeps running in memory for this visit.
class LocalStore {
  constructor(data, persistent = true) { this.data = data ?? {rooms: {}, members: {}, presence: {}}; this.persistent = persistent; }
  persist() { if (this.persistent) save(STORE, this.data); }
  async load(code) { const room = this.data.rooms[code]; return room ? clone(room) : null; }
  async member(digest) { return this.data.members[digest] ?? null; }
  async create(room, digest) {
    if (this.data.rooms[room.code] || this.data.members[digest]) return false;
    this.data.rooms[room.code] = clone(room);
    this.data.members[digest] = {code: room.code, seat: 0};
    this.persist();
    return true;
  }
  async commit(code, previous, room, joining) {
    if ((this.data.rooms[code]?.rev ?? '') !== previous) return false;
    this.data.rooms[code] = clone(room);
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
export const info = () => { boot(); return meta ? {code: meta.code, training: meta.training, name: meta.name} : null; };

export function discard() {
  clearTimeout(timer);
  for (const key of [STORE, META, POINTS]) forget(key);
  store = service = meta = null;
}

// ---------- staging ----------

// Sets a mission round's sealed draws to its scripted values, once, the moment it is dealt.
function stage(room, training) {
  const script = training && SCRIPT[room.round];
  if (!script || room.phase !== 'briefing' || room.staged?.includes(room.round)) return false;
  const n = room.members.length;
  room.demand = [0, 1, 2].map(j => n * RULES.demand[j] * script.demand[j]);
  room.hazards = [...script.hazards];
  room.events = [...script.events];
  (room.staged ??= []).push(room.round);
  return true;
}

// Objectives come from the match seed, so a prepared yard keeps the player's objective.
function assignObjectives(room) {
  room.members.forEach((m, i) => { m.player.objective = OBJECTIVE_SEATS[i]; });
}

async function restage() {
  const room = await store.load(meta.code);
  if (!room || !stage(room, meta.training)) return false;
  store.data.rooms[meta.code] = room;
  store.persist();
  return true;
}

// ---------- matches ----------

async function build(name, {training, code, key, rivalKey}, target) {
  const svc = new GameService(target, RULES, {code: () => code});
  await svc.create(name, key);
  await svc.join(code, RIVAL, rivalKey);
  const lobby = await svc.view(code, key);
  await svc.command(code, key, {kind: 'start', request_id: crypto.randomUUID(), round: lobby.round, phase: lobby.phase});
  const room = await target.load(code);
  assignObjectives(room);
  stage(room, training);
  target.data.rooms[code] = room;
  target.persist();
  return svc;
}

const codeOf = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b & 31]).join('');

export async function create(name, {training = true} = {}) {
  discard();
  boot();
  meta = {code: codeOf(), key: keygen(), rivalKey: keygen(), name, training};
  save(META, meta);
  await build(name, meta, store);
  rivalSoon();
  return {code: meta.code, key: meta.key};
}

// ---------- checkpoints and prepared yards ----------

// A checkpoint is a copy of this browser's practice room at the start of a mission. Retrying
// restores it exactly: same sealed draws, same rival script. It never leaves practice.
export function checkpoint(mission) {
  boot();
  if (!meta) return false;
  const points = read(POINTS) || {};
  if (points[mission]) return true;
  points[mission] = clone(store.data);
  return save(POINTS, points);
}
export const hasCheckpoint = mission => !!(read(POINTS) || {})[mission];

function replace(data) {
  clearTimeout(timer);
  store.data = clone(data);
  store.persist();
  rivalSoon(600);
  notify();
}

export function restore(mission) {
  boot();
  const points = read(POINTS) || {};
  if (!meta || !points[mission]) return false;
  // Later checkpoints belong to the attempt being replaced.
  for (const k of Object.keys(points)) if (Number(k) > mission) delete points[k];
  save(POINTS, points);
  replace(points[mission]);
  return true;
}

// Plays the scripted path from a fresh copy of this match up to the start of `mission`, in a
// scratch store, using the canonical plan for the player. The result is a valid game state the
// engine itself produced; nothing is written by hand.
export async function prepared(mission) {
  boot();
  if (!meta) return false;
  const scratch = new LocalStore(null, false);
  const svc = await build(meta.name, {...meta, training: true}, scratch);
  const act = async (key, extra) => {
    const v = await svc.view(meta.code, key);
    await svc.command(meta.code, key, {request_id: crypto.randomUUID(), round: v.round, phase: v.phase, ...extra});
  };
  for (let round = 1; round < mission; round++) {
    await act(meta.key, {kind: 'ready'});
    await act(meta.rivalKey, {kind: 'ready'});
    await act(meta.rivalKey, {kind: 'lock', plan: rivalPlan(await svc.view(meta.code, meta.rivalKey), true)});
    await act(meta.key, {kind: 'lock', plan: CANON[round]});
    await act(meta.key, {kind: 'ready'});
    await act(meta.rivalKey, {kind: 'ready'});
    const room = await scratch.load(meta.code);
    if (stage(room, true)) scratch.data.rooms[meta.code] = room;
  }
  const points = read(POINTS) || {};
  for (const k of Object.keys(points)) if (Number(k) >= mission) delete points[k];
  points[mission] = clone(scratch.data);
  save(POINTS, points);
  replace(scratch.data);
  return true;
}

// ---------- the local API ----------

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
      commandSchema(clone(body));
      let out = await service.command(code, key, clone(body));
      if (await restage()) out = await service.view(code, key);
      rivalSoon();
      return out;
    }
    previewInput(clone(body));
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

// Mission rounds follow the announced script; other rounds use a plain, steady routine: Belt and
// Cruiser runs. The rival always sells what it hauled unless it can deliver a contract.
function rivalPlan(v, training) {
  const y = v.you, r = v.rules, script = training && SCRIPT[v.round];
  const working = y.drones.filter(d => !d.disabled);
  const allocation = {};
  let fuel = 0, spend = 0;
  working.forEach((d, i) => {
    const j = script ? script.rival[i % script.rival.length] : i % 2;
    if (j !== null && fuel + r.fuel_use[j] <= y.fuel && spend + r.deploy_cost <= y.credits) { allocation[String(d.id)] = j; fuel += r.fuel_use[j]; spend += r.deploy_cost; }
  });
  if (!working.length && y.recovery) allocation['-1'] = 0;
  const contracts = [0, 1, 2].map(j => !y.contracts[j] && y.inventory[j] >= r.contract_qty[j]);
  const commodity_orders = [0, 1, 2].map(j => contracts[j] ? 0 : -E.cargo(Math.min(y.inventory[j], r.commodity_trade[j])));
  const plan = {allocation, bids: [0, 0, 0], commodity_orders, stock_orders: [0, 0, 0], contracts};
  try { E.validate(y, {...plan, allocation: Object.entries(allocation).map(([d, s]) => [Number(d), s])}, v.prices, v.stocks, r); return plan; }
  catch { return {}; }
}

const cmd = (v, extra) => service.command(meta.code, meta.rivalKey, {request_id: crypto.randomUUID(), round: v.round, phase: v.phase, ...extra});

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
    await cmd(v, {kind: 'lock', plan: rivalPlan(v, meta.training)});
  } else if (v.phase === 'upgrade' && !y.ready) {
    for (const d of y.drones.filter(x => x.disabled)) if (v.you.credits >= r.repair_cost + 120) v = await cmd(v, {kind: 'purchase', item: 'repair', drone_id: d.id});
    await cmd(v, {kind: 'ready'});
  } else return;
  await restage();
  notify();
  rivalSoon();
}

// Lets the rival catch up after a reload.
export function wake() { boot(); if (meta) rivalSoon(400); }
