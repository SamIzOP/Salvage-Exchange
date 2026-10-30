// Sends identical boundary requests to the Python server and the Worker and compares status,
// error detail and security headers. usage: node tests/worker/boundary.mjs <python-base> <worker-base>
import {randomBytes} from 'node:crypto';
const [pythonBase, workerBase] = process.argv.slice(2);
const key = () => randomBytes(32).toString('hex');
const SECURITY = ['cache-control', 'x-content-type-options', 'referrer-policy', 'x-frame-options', 'content-security-policy', 'permissions-policy'];

async function send(base, {method = 'GET', path, body, headers = {}}) {
  const res = await fetch(base + path, {method, headers: {...(body !== undefined ? {'Content-Type': 'application/json'} : {}), ...headers},
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)});
  const text = await res.text();
  let detail = null;
  try { detail = JSON.parse(text).detail ?? null; } catch {}
  return {status: res.status, detail, headers: Object.fromEntries(SECURITY.map(h => [h, res.headers.get(h)])), json: (() => { try { return JSON.parse(text); } catch { return null; } })()};
}

async function setup(base) {
  const a = key(), b = key();
  const room = (await send(base, {method: 'POST', path: '/api/rooms', body: {name: 'Orion', rejoin_key: a}})).json;
  return {code: room.code, a, b};
}

const cases = ctx => [
  ['health', {path: '/api/health'}],
  ['extra identity field', {method: 'POST', path: '/api/rooms', body: {name: 'X', rejoin_key: key(), admin: true}}],
  ['malformed JSON', {method: 'POST', path: '/api/rooms', body: '{"name": '}],
  ['non-object body', {method: 'POST', path: '/api/rooms', body: [1, 2]}],
  ['blank name', {method: 'POST', path: '/api/rooms', body: {name: '   ', rejoin_key: key()}}],
  ['long name', {method: 'POST', path: '/api/rooms', body: {name: 'x'.repeat(25), rejoin_key: key()}}],
  ['control character name', {method: 'POST', path: '/api/rooms', body: {name: 'a\u0001b', rejoin_key: key()}}],
  ['uppercase key', {method: 'POST', path: '/api/rooms', body: {name: 'X', rejoin_key: key().toUpperCase()}}],
  ['foreign origin', {method: 'POST', path: '/api/rooms', body: {name: 'X', rejoin_key: key()}, headers: {Origin: 'https://evil.example'}}],
  ['oversized body', {method: 'POST', path: '/api/rooms', body: {name: 'X', rejoin_key: key(), pad: 'x'.repeat(20000)}}],
  ['missing bearer', {path: `/api/rooms/${ctx.code}`}],
  ['malformed bearer', {path: `/api/rooms/${ctx.code}`, headers: {Authorization: 'Bearer nope'}}],
  ['unknown bearer', {path: `/api/rooms/${ctx.code}`, headers: {Authorization: `Bearer ${key()}`}}],
  ['wrong scheme', {path: `/api/rooms/${ctx.code}`, headers: {Authorization: `Basic ${ctx.a}`}}],
  ['lowercase code view', {path: `/api/rooms/${ctx.code.toLowerCase()}`, headers: {Authorization: `Bearer ${ctx.a}`}}],
  ['join missing room', {method: 'POST', path: '/api/rooms/ZZZZZZ/join', body: {name: 'Nova', rejoin_key: ctx.b}}],
  ['join duplicate name', {method: 'POST', path: `/api/rooms/${ctx.code}/join`, body: {name: 'ORION', rejoin_key: key()}}],
  ['forged command kind', {method: 'POST', path: `/api/rooms/${ctx.code}/commands`, headers: {Authorization: `Bearer ${ctx.a}`}, body: {kind: 'resolve', request_id: '1', round: 0, phase: 'lobby'}}],
  ['command extra field', {method: 'POST', path: `/api/rooms/${ctx.code}/commands`, headers: {Authorization: `Bearer ${ctx.a}`}, body: {kind: 'start', request_id: '1', round: 0, phase: 'lobby', credits: 9999}}],
  ['command bool round', {method: 'POST', path: `/api/rooms/${ctx.code}/commands`, headers: {Authorization: `Bearer ${ctx.a}`}, body: {kind: 'start', request_id: '1', round: true, phase: 'lobby'}}],
  ['plan extra field', {method: 'POST', path: `/api/rooms/${ctx.code}/commands`, headers: {Authorization: `Bearer ${ctx.a}`}, body: {kind: 'lock', request_id: '1', round: 0, phase: 'lobby', plan: {player_id: 1}}}],
  ['plan bad drone id', {method: 'POST', path: `/api/rooms/${ctx.code}/commands`, headers: {Authorization: `Bearer ${ctx.a}`}, body: {kind: 'lock', request_id: '1', round: 0, phase: 'lobby', plan: {allocation: {'01': 0}}}}],
  ['plan order out of range', {method: 'POST', path: `/api/rooms/${ctx.code}/commands`, headers: {Authorization: `Bearer ${ctx.a}`}, body: {kind: 'lock', request_id: '1', round: 0, phase: 'lobby', plan: {commodity_orders: [5, 0, 0]}}}],
  ['start alone', {method: 'POST', path: `/api/rooms/${ctx.code}/commands`, headers: {Authorization: `Bearer ${ctx.a}`}, body: {kind: 'start', request_id: 'solo', round: 0, phase: 'lobby'}}],
  ['stale phase', {method: 'POST', path: `/api/rooms/${ctx.code}/commands`, headers: {Authorization: `Bearer ${ctx.a}`}, body: {kind: 'ready', request_id: 'stale', round: 3, phase: 'upgrade'}}],
  ['preview factor out of range', {method: 'POST', path: `/api/rooms/${ctx.code}/preview`, headers: {Authorization: `Bearer ${ctx.a}`}, body: {plan: {}, rival_factor: 3}}],
  ['preview in lobby', {method: 'POST', path: `/api/rooms/${ctx.code}/preview`, headers: {Authorization: `Bearer ${ctx.a}`}, body: {plan: {}}}],
  ['wrong method', {path: '/api/rooms'}],
  ['unknown api path', {path: '/api/nope'}],
  ['server source', {path: '/server/app.py'}],
  ['database file', {path: '/data/rooms.sqlite3'}],
  ['git config', {path: '/.git/config'}],
  ['docs', {path: '/docs/QA_REPORT_AB.md'}],
  ['worker source', {path: '/worker/src/game.js'}],
  ['post to health', {method: 'POST', path: '/api/health', body: {}}],
  ['get on commands', {path: `/api/rooms/${ctx.code}/commands`}],
  ['post to static file', {method: 'POST', path: '/styles.css', body: {}}],
  ['index page', {path: '/'}],
  ['stylesheet', {path: '/styles.css'}],
];

const py = await setup(pythonBase), wk = await setup(workerBase);
let failures = 0;
for (const [i, [name, pyReq]] of cases(py).entries()) {
  const wkReq = cases(wk)[i][1];
  const [a, b] = [await send(pythonBase, pyReq), await send(workerBase, wkReq)];
  const same = a.status === b.status && a.detail === b.detail && SECURITY.every(h => a.headers[h] === b.headers[h]);
  if (!same) failures++;
  console.log(`${same ? 'same' : 'DIFF'}  ${String(a.status).padEnd(4)} ${name}${same ? '' : `  python=${a.status} ${a.detail} worker=${b.status} ${b.detail} ${SECURITY.filter(h => a.headers[h] !== b.headers[h]).join(',')}`}`);
}
console.log(`${failures} differences across ${cases(py).length} boundary requests`);
process.exit(failures ? 1 : 0);
