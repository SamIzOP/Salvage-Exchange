import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join, dirname, normalize} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const memory = new Map();
globalThis.localStorage = {getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k)};
globalThis.fetch = () => { throw new Error('practice must never use the network'); };
const P = await import('../web/practice.js');
const {SCRIPT, CANON, RIVAL} = await import('../web/missions.js');
const L = await import('../web/lessons.js');
const M = await import('../web/model.js');
const RULES = JSON.parse(readFileSync(join(root, 'simulation/rules-v0.2.json'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const worth = v => M.sum(Object.values(v.you.breakdown));

function client(code, key) {
  let v;
  const view = async () => (v = await P.api(`/rooms/${code}`, undefined, key));
  const send = async extra => (v = await P.api(`/rooms/${code}/commands`, {request_id: crypto.randomUUID(), round: v.round, phase: v.phase, ...extra}, key));
  const until = async ok => { for (let i = 0; i < 60; i++) { await view(); if (ok(v)) return v; await sleep(80); } throw new Error('rival never acted'); };
  return {view, send, until, get v() { return v; }};
}

// Plays one round from briefing to settlement with the given plan and briefing purchases.
async function playRound(c, plan, {fuel = 0, scans = []} = {}) {
  await c.view();
  if (fuel) await c.send({kind: 'purchase', item: 'fuel', quantity: fuel});
  for (const j of scans) await c.send({kind: 'scan', target: 'hazard', sector: j});
  await c.send({kind: 'ready'});
  await c.until(v => v.phase === 'planning' && v.players[1].locked);
  await c.send({kind: 'lock', plan});
  return c.v;
}

test('the frozen rules module in web/ matches the rules JSON exactly', async () => {
  const {default: rules} = await import('../web/engine/rules.js');
  assert.deepEqual(rules, RULES);
});

test('training rounds are dealt from valid outcomes and staged once each', async () => {
  for (const s of Object.values(SCRIPT)) {
    assert.ok(s.demand.every(m => [.8, 1, 1.2].includes(m)));
    assert.ok(s.hazards.every(h => [1, .5, 0].includes(h)));
    assert.ok(s.events.every(e => [-.08, 0, .08].includes(e)));
  }
  const {code, key} = await P.create('Orion Salvage');
  const c = client(code, key);
  await c.view();
  assert.deepEqual(c.v.demand, [4.5, 3, 1.5]);
  assert.equal(c.v.you.objective, 'Logistics Empire');
  await c.send({kind: 'scan', target: 'hazard', sector: 2});
  assert.equal(c.v.you.scans[0].value, SCRIPT[1].hazards[2], 'a scan reveals the staged hazard');
  const v = await playRound(c, CANON[1]);
  assert.deepEqual(v.history[0].hazards, SCRIPT[1].hazards);
  // The rival followed its announced training plan.
  assert.deepEqual(Object.values(v.history[0].plans[1].allocation), SCRIPT[1].rival);
  await c.send({kind: 'ready'});
  const r2 = await c.until(x => x.round === 2);
  assert.deepEqual(r2.demand, SCRIPT[2].demand.map((m, j) => 2 * RULES.demand[j] * m), 'round 2 is staged before the player sees it');
});

test('free practice is not staged and still plays a full match locally', async () => {
  const {code, key} = await P.create('Vega', {training: false});
  assert.equal(P.info().training, false);
  const c = client(code, key);
  for (let round = 1; round <= 6; round++) {
    await playRound(c, {allocation: {'0': 0}});
    if (c.v.phase === 'finished') break;
    await c.send({kind: 'ready'});
    await c.until(v => v.round === round + 1);
  }
  assert.equal(c.v.phase, 'finished');
  assert.equal(c.v.history.length, 6);
});

test('practice answers with the same errors and statuses as the server', async () => {
  const {code, key} = await P.create('Vega');
  const c = client(code, key);
  await c.view();
  const fail = (body, status, detail) => assert.rejects(P.api(`/rooms/${code}/commands`, body, key), err => err.status === status && err.message === detail);
  await fail({kind: 'lock', request_id: 'a', round: 1, phase: 'briefing', plan: {}}, 409, 'Plan cannot be changed in this phase');
  await fail({kind: 'ready', request_id: 'b', round: 1, phase: 'briefing', extra: 1}, 422, 'Invalid request. Check values and permitted fields.');
  await fail({kind: 'scan', request_id: 'c', round: 2, phase: 'briefing', target: 'hazard', sector: 0}, 409, 'The phase changed. Refresh and try again.');
  await assert.rejects(P.api(`/rooms/${code}`, undefined, 'f'.repeat(64)), err => err.status === 401);
});

test('checkpoints restore a mission exactly and touch nothing outside practice', async () => {
  memory.set('sx-sessions', JSON.stringify({LIVE22: {key: 'a'.repeat(64), name: 'Live crew'}}));
  memory.set('sx-active', JSON.stringify({code: 'LIVE22', key: 'a'.repeat(64), generation: 1}));
  const {code, key} = await P.create('Orion Salvage');
  const c = client(code, key);
  assert.ok(P.checkpoint(1));
  const start = JSON.stringify(await c.view());
  await playRound(c, {allocation: {'0': 2}});
  assert.equal(c.v.phase, 'upgrade');
  assert.ok(P.restore(1));
  await c.view();
  const again = JSON.parse(start), now = c.v;
  assert.deepEqual({round: now.round, phase: now.phase, you: now.you.credits, prices: now.prices, demand: now.demand, history: now.history.length},
    {round: again.round, phase: again.phase, you: again.you.credits, prices: again.prices, demand: again.demand, history: 0});
  // The same sealed draws come back: the retried round settles the same hazards.
  const v = await playRound(c, CANON[1]);
  assert.deepEqual(v.history[0].hazards, SCRIPT[1].hazards);
  assert.equal(memory.get('sx-sessions'), JSON.stringify({LIVE22: {key: 'a'.repeat(64), name: 'Live crew'}}));
  assert.equal(JSON.parse(memory.get('sx-active')).code, 'LIVE22');
});

test('prepared yards are engine-produced states that meet each mission’s needs', async () => {
  const {code, key} = await P.create('Orion Salvage');
  const c = client(code, key);
  for (const n of [2, 3, 4]) {
    assert.ok(await P.prepared(n));
    const v = await c.view(), m = L.missionFor(n);
    assert.equal(v.round, m.round);
    assert.equal(v.phase, 'briefing');
    assert.equal(v.history.length, m.round - 1);
    const ctx = {y: v.you, s: v, r: v.rules};
    assert.ok(!m.needs || m.needs(ctx), `mission ${n} can start from its prepared yard`);
    assert.deepEqual(v.demand, SCRIPT[n].demand.map((x, j) => 2 * RULES.demand[j] * x));
  }
  // Mission 2's prepared yard came from delivering a contract in the canonical round 2.
  assert.deepEqual(c.v.you.contracts, [true, false, false]);
});

test('mission 4’s objective is achievable under the engine, and the risky plan fails it', async () => {
  const {code, key} = await P.create('Orion Salvage');
  const c = client(code, key), m = L.missionFor(4);
  const trial = async (fuel, plan) => {
    await P.prepared(4);
    const start = worth(await c.view());
    const v = await playRound(c, plan, {fuel});
    const report = v.you.reports.at(-1), acc = L.accounts(report, v.history.at(-1), 0);
    return m.complete({acc, flags: {startWorth: start}});
  };
  assert.equal(await trial(3, {allocation: {'0': 0, '1': 1}}), true, 'the worked-example plan meets the objective');
  assert.equal(await trial(4, {allocation: {'0': 1, '1': 1}}), true, 'two drones to the Cruiser meet it too');
  assert.equal(await trial(3, {allocation: {'0': 2}}), false, 'the severe Rift disables a drone');
  assert.equal(await trial(0, {}), false, 'staying docked loses value to depreciation');
});

test('mission steps check the actual requested state, and alternatives are acknowledged', () => {
  const m1 = L.missionFor(1), m2 = L.missionFor(2);
  const y = {ready: false, locked: false, plan: null, drones: [{id: 0, disabled: false}, {id: 1, disabled: false}], inventory: [2.25, .75, 0], contracts: [false, false, false], scans: []};
  const ctx = (allocation, extra = {}) => ({y, r: RULES, s: {demand: [4.5, 3, 1.5]}, phase: 'planning', flags: {}, ev: {plan: {allocation, commodity_orders: [0, 0, 0]}}, ...extra});
  const belt = m1.steps[1];
  assert.equal(belt.done(ctx({'0': 1})), false, 'a drone at the Cruiser does not count as the Belt');
  assert.match(belt.alt(ctx({'0': 1})), /Derelict Cruiser instead/);
  assert.equal(belt.done(ctx({'1': 0})), true, 'any drone at the Belt satisfies the step');
  assert.equal(belt.alt(ctx({'1': 0})), '');
  // The lock step is never ticked before the plan is locked.
  assert.equal(m1.steps[3].done({...ctx({}), phase: 'briefing'}), false);
  const sell = m2.steps[1];
  assert.equal(sell.done({...ctx({}), ev: {plan: {allocation: {}, commodity_orders: [0, -0.75, 0]}}}), true);
  assert.equal(sell.done({...ctx({}), ev: {plan: {allocation: {}, commodity_orders: [0, 0, -1]}}}), false, 'selling something you do not hold is not the lesson');
});

test('debrief accounting reconciles exactly and keeps cash, assets and fuel apart', async () => {
  const {code, key} = await P.create('Orion Salvage');
  const c = client(code, key);
  await playRound(c, CANON[1]);
  const report = c.v.you.reports[0], log = c.v.history[0], acc = L.accounts(report, log, 0);
  assert.equal(M.cents(M.sum(acc.parts.map(p => p[2]))), M.cents(acc.change), 'the parts add up to the change');
  assert.equal(M.cents(acc.change), M.cents(log.deltas[0] + (report.after.objective - report.before.objective)));
  assert.equal(acc.fuel, 3, 'fuel used is reported as units, not value');
  assert.ok(!acc.parts.some(([k]) => k === 'fuel'), 'fuel is not a value line');
  const html = L.missionFor(1).debrief({...{y: c.v.you, r: RULES, s: c.v, seat: 0, log, acc}});
  assert.match(html, /isn’t cash until you sell it/);
  assert.match(html, /62\.40 cr<\/b> of fleet depreciation/);
});

test('every module the client loads exists in web/ and in the built dist/', () => {
  execFileSync(process.execPath, ['scripts/build.mjs'], {cwd: root, stdio: 'ignore'});
  const seen = new Set(), queue = ['web/app.js'];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(join(root, file), 'utf8');
    for (const [, spec] of text.matchAll(/(?:from\s+|import\()\s*'(\.[^']+)'/g)) queue.push(normalize(join(dirname(file), spec)).replaceAll('\\', '/'));
  }
  for (const file of seen) {
    assert.ok(existsSync(join(root, file)), `${file} exists`);
    assert.ok(existsSync(join(root, file.replace(/^web\//, 'dist/'))), `${file} is in dist/`);
  }
  for (const needed of ['web/practice.js', 'web/engine/game.js', 'web/engine/economy.js', 'web/engine/schema.js', 'web/engine/rules.js']) assert.ok(seen.has(needed), `${needed} is loaded`);
  assert.ok(!existsSync(join(root, 'dist/coach.js')), 'removed files do not linger in dist/');
});
