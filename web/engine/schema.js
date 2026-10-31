// Strict wire schemas mirroring server/models.py: clients submit intentions, never balances
// or outcomes. Unknown fields, wrong types and out-of-range values are rejected.

export class SchemaError extends Error {}
const fail = () => { throw new SchemaError('invalid'); };
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const codePoints = s => [...s].length;
const isInt = v => typeof v === 'number' && Number.isInteger(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);

function fields(value, allowed) {
  if (!isObject(value)) fail();
  for (const k of Object.keys(value)) if (!allowed.includes(k)) fail();
  return value;
}
const str = (v, min, max) => { if (typeof v !== 'string' || codePoints(v) < min || codePoints(v) > max) fail(); return v; };
const int = (v, lo = -Infinity, hi = Infinity) => { if (!isInt(v) || v < lo || v > hi) fail(); return v; };
const optional = (v, check) => v === undefined || v === null ? null : check(v);
const oneOf = (v, options) => { if (!options.includes(v)) fail(); return v; };
const triple = (v, fallback, check) => {
  if (v === undefined) return fallback();
  if (!Array.isArray(v) || v.length !== 3) fail();
  return v.map(check);
};

export function identity(raw) {
  const v = fields(raw, ['name', 'rejoin_key']);
  let name = str(v.name, 1, 24).trim();
  if (!name || [...name].some(c => c.codePointAt(0) < 32)) fail();
  if (typeof v.rejoin_key !== 'string' || !/^[a-f0-9]{64}$/.test(v.rejoin_key)) fail();
  return {name, rejoin_key: v.rejoin_key};
}

// Drone IDs are canonical integers from -1 (recovery) to 1000, as server/models.py requires.
const canonicalId = k => /^(-1|0|[1-9][0-9]{0,3})$/.test(k) && Number(k) <= 1000;

export function plan(raw) {
  const v = fields(raw ?? {}, ['allocation', 'bids', 'commodity_orders', 'stock_orders', 'contracts']);
  let allocation = [];
  if (v.allocation !== undefined) {
    if (!isObject(v.allocation)) fail();
    const entries = Object.entries(v.allocation);
    if (entries.length > 5) fail();
    for (const [k, s] of entries) { int(s); if (!canonicalId(k)) fail(); }
    allocation = entries.map(([k, s]) => [k, s]);
  }
  return {
    allocation,
    bids: triple(v.bids, () => [0, 0, 0], b => int(b)),
    commodity_orders: triple(v.commodity_orders, () => [0, 0, 0], q => { if (!isNum(q) || q < -4 || q > 4) fail(); return q; }),
    stock_orders: triple(v.stock_orders, () => [0, 0, 0], q => int(q)),
    contracts: triple(v.contracts, () => [false, false, false], c => { if (typeof c !== 'boolean') fail(); return c; }),
  };
}

// The stored form keeps drone IDs as string keys, matching Python's model_dump().
export const planDump = p => ({allocation: Object.fromEntries(p.allocation), bids: p.bids, commodity_orders: p.commodity_orders,
  stock_orders: p.stock_orders, contracts: p.contracts});
// The economy form uses integer drone IDs in submission order.
export const planForEconomy = p => ({...p, allocation: (Array.isArray(p.allocation) ? p.allocation : Object.entries(p.allocation)).map(([k, s]) => [Number(k), s])});

export function command(raw) {
  const v = fields(raw, ['kind', 'request_id', 'round', 'phase', 'plan', 'item', 'quantity', 'drone_id', 'target', 'sector']);
  return {
    kind: oneOf(v.kind, ['start', 'ready', 'scan', 'purchase', 'lock']),
    request_id: str(v.request_id, 1, 80),
    round: int(v.round, 0, 6),
    phase: oneOf(v.phase, ['lobby', 'briefing', 'planning', 'upgrade', 'finished']),
    plan: v.plan === undefined || v.plan === null ? null : plan(v.plan),
    item: optional(v.item, i => oneOf(i, ['fuel', 'drone', 'repair', 'insurance', 'scanner', 'retire'])),
    quantity: v.quantity === undefined ? 1 : int(v.quantity, 1, 16),
    drone_id: optional(v.drone_id, d => int(d)),
    target: optional(v.target, t => oneOf(t, ['hazard', 'event'])),
    sector: v.sector === undefined ? 0 : int(v.sector, 0, 2),
  };
}

export function previewInput(raw) {
  const v = fields(raw, ['plan', 'rival_factor']);
  const factor = v.rival_factor === undefined ? 1 : v.rival_factor;
  if (!isNum(factor) || factor < 0 || factor > 2) fail();
  return {plan: plan(v.plan ?? {}), rival_factor: factor};
}

// A canonical fingerprint of the validated command, so a retry with the same request ID
// and content is recognised while a reused ID with different content is refused.
export function fingerprintText(cmd) {
  const sorted = value => Array.isArray(value) ? value.map(sorted)
    : isObject(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])])) : value;
  return JSON.stringify(sorted({...cmd, plan: cmd.plan && planDump(cmd.plan)}));
}
