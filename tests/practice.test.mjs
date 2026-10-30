import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {steps} from '../web/tutorial.js';

// The practice module imports the engine the build copies next to it, so test the built copy.
const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, ['scripts/build.mjs'], {cwd: root, stdio: 'ignore'});
const memory = new Map();
globalThis.localStorage = {getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k)};
globalThis.fetch = () => { throw new Error('practice must never use the network'); };
const P = await import('../dist/practice.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(code, key, ok) {
  for (let i = 0; i < 40; i++) { const v = await P.api(`/rooms/${code}`, undefined, key); if (ok(v)) return v; await sleep(100); }
  throw new Error('rival never acted');
}

test('practice plays a whole match locally against the training rival', async () => {
  const {code, key} = await P.create('Orion Salvage');
  assert.equal(P.owns(key), true);
  let v = await P.api(`/rooms/${code}`, undefined, key);
  assert.equal(v.phase, 'briefing');
  assert.deepEqual(v.players.map(p => p.name), ['Orion Salvage', 'Kestrel Haulers']);
  assert.deepEqual(v.demand, [4.5, 3, 1.5], 'round 1 posts normal demand');
  const send = extra => P.api(`/rooms/${code}/commands`, {request_id: crypto.randomUUID(), round: v.round, phase: v.phase, ...extra}, key);
  v = await send({kind: 'scan', target: 'hazard', sector: 2});
  assert.deepEqual(v.you.scans, [{target: 'hazard', sector: 2, value: 0}], 'the staged Rift is severe');
  v = await until(code, key, x => x.players[1].ready);
  v = await send({kind: 'ready'});
  assert.equal(v.phase, 'planning');
  const plan = {allocation: {'0': 0, '1': 1}, stock_orders: [1, 0, 0]};
  const preview = await P.api(`/rooms/${code}/preview`, {plan, rival_factor: 1}, key);
  assert.equal(preview.estimate, true);
  v = await until(code, key, x => x.players[1].locked);
  v = await send({kind: 'lock', plan});
  assert.equal(v.phase, 'upgrade');
  const log = v.history[0];
  assert.deepEqual(log.hazards, [1, .5, 0]);
  assert.deepEqual(log.gains[0], [2.25, .75, 0], 'Belt shared with the rival, Cruiser at half yield');
  for (let i = 0; i < 300 && v.phase !== 'finished'; i++) {
    if (!v.you.ready && !v.you.locked && ['briefing', 'upgrade'].includes(v.phase)) v = await send({kind: 'ready'});
    else if (v.phase === 'planning' && !v.you.locked) v = await send({kind: 'lock', plan: {allocation: {'0': 0}}});
    await sleep(120);
    v = await P.api(`/rooms/${code}`, undefined, key);
  }
  assert.equal(v.phase, 'finished');
  assert.equal(v.history.length, 6);
  assert.ok(v.players.every(p => p.objective), 'objectives are revealed at the end');
});

test('practice answers with the same errors and statuses as the server', async () => {
  const {code, key} = await P.create('Vega');
  const v = await P.api(`/rooms/${code}`, undefined, key);
  const fail = async (path, body, status, detail) => {
    await assert.rejects(P.api(path, body, key), err => err.status === status && err.message === detail);
  };
  await fail(`/rooms/${code}/commands`, {kind: 'lock', request_id: 'a', round: v.round, phase: v.phase, plan: {}}, 409, 'Plan cannot be changed in this phase');
  await fail(`/rooms/${code}/commands`, {kind: 'ready', request_id: 'b', round: v.round, phase: v.phase, extra: 1}, 422, 'Invalid request. Check values and permitted fields.');
  await fail(`/rooms/${code}/commands`, {kind: 'scan', request_id: 'c', round: v.round + 1, phase: v.phase, target: 'hazard', sector: 0}, 409, 'The phase changed. Refresh and try again.');
  await assert.rejects(P.api(`/rooms/${code}`, undefined, 'f'.repeat(64)), err => err.status === 401);
  assert.equal(P.owns('f'.repeat(64)), false);
});

test('a new practice replaces the old one and survives a reload', async () => {
  const first = await P.create('First');
  const second = await P.create('Second');
  assert.equal(P.owns(first.key), false);
  assert.ok(memory.get('sx-practice-store').includes(second.code));
  assert.ok(!memory.get('sx-practice-store').includes(first.code));
});

test('guide steps are ordered by round and phase and every step can be followed', () => {
  const order = ['briefing', 'planning', 'upgrade'];
  const at = s => s.round * 10 + order.indexOf(s.phase);
  steps.forEach((s, i) => {
    assert.ok(order.includes(s.phase), s.id);
    if (i) assert.ok(at(s) >= at(steps[i - 1]), `${s.id} is out of order`);
    assert.ok(!s.action || typeof s.done === 'function', `${s.id} waits for an action it can detect`);
    assert.ok(s.final || s.target || i === 0, `${s.id} points at something`);
  });
  assert.equal(new Set(steps.map(s => s.id)).size, steps.length, 'step ids are unique');
  assert.ok(steps.at(-1).final);
});
