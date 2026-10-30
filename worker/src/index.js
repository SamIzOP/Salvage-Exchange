// HTTP boundary and same-origin frontend for Workers-style hosts such as ChatGPT Sites.
// Mirrors server/app.py: same routes, errors, limits and security headers.
import RULES from '../../simulation/rules-v0.2.json';
import {GameService, GameError} from './game.js';
import {D1Store} from './store.js';
import {SchemaError, identity, command, previewInput} from './schema.js';

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
const INVALID = 'Invalid request. Check values and permitted fields.';
const MAX_BODY = 16384;

const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const detail = (message, status) => json({detail: message}, status);
// As in server/app.py, unmatched requests fall through to the static files, which answer 404 for
// reads and 405 for anything else.
const unmatched = method => method === 'GET' || method === 'HEAD' ? detail('Not Found', 404) : detail('Method Not Allowed', 405);

// Best effort: limits are per isolate, so a host-level rate limit is still needed in production.
const hits = new Map();
function limited(ip, bucket, limit) {
  const now = Date.now() / 1000;
  if (hits.size > 10000) for (const [k, v] of hits) if (!v.length || v.at(-1) < now - 60) hits.delete(k);
  const key = `${ip}|${bucket}`, list = (hits.get(key) ?? []).filter(t => t >= now - 60);
  hits.set(key, list);
  if (list.length >= limit) return true;
  list.push(now);
  return false;
}

async function readBody(request) {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { body.set(c, at); at += c.length; }
  return body;
}

const hostAllowed = (host, patterns) => patterns.some(p => p === '*' || p === host || (p.startsWith('*.') && host.endsWith(p.slice(1))));
const list = value => value ? value.split(',').map(s => s.trim()).filter(Boolean) : null;

let cached;
const serviceFor = env => {
  if (!cached || cached.db !== env.DB) cached = {db: env.DB, service: new GameService(new D1Store(env.DB), RULES)};
  return cached.service;
};

function token(request) {
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) throw new GameError('Rejoin key required', 401);
  return header.slice(7);
}

async function api(request, env, url, body) {
  const path = url.pathname, method = request.method;
  const parse = validator => {
    let raw;
    try { raw = JSON.parse(new TextDecoder().decode(body)); } catch { throw new SchemaError('invalid'); }
    validator(raw);
    return raw;
  };
  if (path === '/api/health') {
    if (method !== 'GET' && method !== 'HEAD') return unmatched(method);
    return json({status: 'ok', economy: '0.2'});
  }
  const service = serviceFor(env);
  if (path === '/api/rooms') {
    if (method !== 'POST') return unmatched(method);
    const v = parse(identity);
    return json(await service.create(v.name, v.rejoin_key));
  }
  const match = path.match(/^\/api\/rooms\/([^/]+)(\/join|\/commands|\/preview)?$/);
  if (!match) return unmatched(method);
  let code;
  try { code = decodeURIComponent(match[1]).toUpperCase(); } catch { return unmatched(method); }
  const action = match[2];
  if (!action) {
    if (method !== 'GET' && method !== 'HEAD') return unmatched(method);
    return json(await service.view(code, token(request)));
  }
  if (method !== 'POST') return unmatched(method);
  if (action === '/join') { const v = parse(identity); return json(await service.join(code, v.name, v.rejoin_key)); }
  if (action === '/commands') { const v = parse(command); return json(await service.command(code, token(request), v)); }
  const v = parse(previewInput);
  return json(await service.preview(code, token(request), v.plan ?? {}, v.rival_factor ?? 1));
}

async function handle(request, env) {
  const url = new URL(request.url), method = request.method;
  let body = new Uint8Array();
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('Origin');
    const origins = list(env.ALLOWED_ORIGINS) ?? [url.origin];
    if (origin && !origins.includes(origin)) return detail('Origin is not allowed', 403);
    body = await readBody(request);
    if (body === null) return detail('Request is too large', 413);
  }
  if (url.pathname.startsWith('/api/')) {
    const read = method === 'GET' || url.pathname.endsWith('/preview');
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (limited(ip, read ? 'read' : 'write', Number(read ? env.READ_LIMIT ?? 600 : env.WRITE_LIMIT ?? 120))) {
      return detail('Too many requests. Wait a minute.', 429);
    }
  }
  const hosts = list(env.ALLOWED_HOSTS);
  if (hosts && !hostAllowed((request.headers.get('Host') ?? url.host).split(':')[0], hosts)) {
    return new Response('Invalid host header', {status: 400, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
  }
  if (url.pathname.startsWith('/api/')) {
    try { return await api(request, env, url, body); }
    catch (err) {
      if (err instanceof GameError) return detail(err.message, err.status);
      // Never echo submitted credentials or hidden plans in validation messages.
      if (err instanceof SchemaError) return detail(INVALID, 422);
      console.error(err);
      return detail('Internal Server Error', 500);
    }
  }
  if ((method !== 'GET' && method !== 'HEAD') || !env.ASSETS) return unmatched(method);
  const asset = await env.ASSETS.fetch(request);
  return asset.status === 404 ? unmatched(method) : asset;
}

export default {
  async fetch(request, env) {
    const response = await handle(request, env);
    const out = new Response(response.body, response);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },
};
