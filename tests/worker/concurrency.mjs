// Races the last two locks (plus a duplicate retry) against a running server and checks that each
// round settles exactly once and charges once. usage: node tests/worker/concurrency.mjs <base> [rooms]
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
const [base, rooms = 25] = process.argv.slice(2);
const key = () => randomBytes(32).toString('hex');

async function call(path, body, k) {
  const res = await fetch(`${base}/api${path}`, {method: body ? 'POST' : 'GET',
    headers: {...(body ? {'Content-Type': 'application/json'} : {}), ...(k ? {Authorization: `Bearer ${k}`} : {})}, body: body && JSON.stringify(body)});
  return {status: res.status, body: await res.json()};
}
const command = (code, k, st, extra) => call(`/rooms/${code}/commands`, {request_id: randomUUID(), round: st.round, phase: st.phase, ...extra}, k);

let races = 0;
for (let i = 0; i < Number(rooms); i++) {
  const a = key(), b = key();
  const {body: room} = await call('/rooms', {name: `Race ${i} A`, rejoin_key: a});
  // Two joins racing for the last seats must both land, in distinct seats.
  const c = key();
  const joins = await Promise.all([call(`/rooms/${room.code}/join`, {name: `Race ${i} B`, rejoin_key: b}), call(`/rooms/${room.code}/join`, {name: `Race ${i} C`, rejoin_key: c})]);
  assert.deepEqual(joins.map(j => j.status), [200, 200]);
  assert.notEqual(joins[0].body.you.seat, joins[1].body.you.seat);
  let st = (await call(`/rooms/${room.code}`, undefined, a)).body;
  st = (await command(room.code, a, st, {kind: 'start'})).body;
  for (const k of [a, b, c]) st = (await command(room.code, k, (await call(`/rooms/${room.code}`, undefined, k)).body, {kind: 'ready'})).body;
  assert.equal(st.phase, 'planning');
  await command(room.code, c, st, {kind: 'lock', plan: {}});
  const lockA = {kind: 'lock', request_id: randomUUID(), round: st.round, phase: st.phase, plan: {allocation: {'0': 0}, commodity_orders: [1, 0, 0]}};
  const lockB = {kind: 'lock', request_id: randomUUID(), round: st.round, phase: st.phase, plan: {allocation: {'0': 0}}};
  const results = await Promise.all([
    call(`/rooms/${room.code}/commands`, lockA, a), call(`/rooms/${room.code}/commands`, lockB, b), call(`/rooms/${room.code}/commands`, lockA, a)]);
  assert.deepEqual(results.map(r => r.status), [200, 200, 200], JSON.stringify(results.map(r => r.body.detail)));
  const views = await Promise.all([a, b, c].map(k => call(`/rooms/${room.code}`, undefined, k)));
  for (const v of views) {
    assert.equal(v.body.phase, 'upgrade');
    assert.equal(v.body.history.length, 1, 'settled exactly once');
  }
  assert.deepEqual(views[0].body.history, views[1].body.history);
  // One deployment (6) and one Alloy buy (24 × 1.02) for A, despite the duplicate lock.
  assert.equal(views[0].body.you.credits, 750 - 6 - 24.48);
  assert.equal(views[1].body.you.credits, 750 - 6);
  races++;
}
console.log(`${races} rooms: racing joins seated distinctly; racing last locks with a duplicate settled exactly once and charged once`);
