import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as M from '../web/model.js';

const rules = JSON.parse(readFileSync(new URL('../simulation/rules-v0.2.json', import.meta.url)));
const you = {credits: 750, fuel: 8, drones: [{id: 0, value: 260, disabled: false, insured: false}, {id: 1, value: 260, disabled: false, insured: false}],
  inventory: [2.775, 0, 0], shares: [5, 0, 0], contracts: [false, false, false], recovery: false};
const ctx = {you, prices: [24, 42, 72], stocks: [100, 100, 100], rules};
const draft = (edit) => { const d = M.emptyDraft(); edit(d); return d; };

test('Buy / Sell / Hold controls translate to the signed server plan', () => {
  const d = draft(d => {
    d.allocation = {'0': 0, '1': 2}; d.bids[2] = '15';
    d.cargo[0] = {side: 'sell', qty: '2.775'}; d.cargo[1] = {side: 'buy', qty: '1'};
    d.shares[0] = {side: 'buy', qty: '1'}; d.contracts[2] = true;
  });
  const ev = M.evaluate(d, ctx);
  assert.equal(ev.valid, true, JSON.stringify(ev.errors));
  assert.deepEqual(ev.plan, {allocation: {'0': 0, '1': 2}, bids: [0, 0, 15], commodity_orders: [-2.775, 1, 0],
    stock_orders: [1, 0, 0], contracts: [false, false, true]});
  assert.deepEqual(M.draftFromPlan(ev.plan).cargo, d.cargo);
});

test('reservation mirrors the server: deployment, bids and fee-inclusive buys, never sale proceeds', () => {
  const d = draft(d => { d.allocation = {'0': 0, '1': 2}; d.bids[2] = '15'; d.cargo[1] = {side: 'buy', qty: '1'}; d.cargo[0] = {side: 'sell', qty: '2'}; });
  const t = M.evaluate(d, ctx).totals;
  assert.equal(t.deployment, 12);
  assert.equal(t.fuel, 4);
  assert.equal(t.reserved, 12 + 15 + 42.84);
  assert.equal(t.available, 750 - 69.84);
  assert.equal(t.sells, 47.04);
  assert.equal(t.idle, 0);
});

test('invalid quantities are explained beside the control and never rewritten', () => {
  const d = draft(d => {
    d.cargo[0] = {side: 'buy', qty: '5'}; d.cargo[2] = {side: 'sell', qty: '1'};
    d.shares[0] = {side: 'buy', qty: '2'}; d.shares[1] = {side: 'buy', qty: '1.5'}; d.cargo[1] = {side: 'buy', qty: ''};
  });
  const ev = M.evaluate(d, ctx);
  assert.equal(ev.valid, false);
  assert.match(ev.errors['cargo-0'], /up to 4 per round/);
  assert.match(ev.errors['cargo-2'], /hold none/);
  assert.match(ev.errors['shares-0'], /Holding limit is 6\. You hold 5, so you can buy up to 1/);
  assert.match(ev.errors['shares-1'], /whole numbers/);
  assert.match(ev.errors['cargo-1'], /Enter how many/);
  assert.equal(d.cargo[0].qty, '5');
  assert.equal(M.blocksEstimate(ev.errors), true);
});

test('bids need a drone in the sector and stay within 1–120', () => {
  const ev = M.evaluate(draft(d => { d.bids = ['10', '0', '130']; d.allocation = {'0': 2}; }), ctx);
  assert.match(ev.errors['bid-0'], /Assign a drone here first/);
  assert.match(ev.errors['bid-2'], /1–120/);
  assert.equal(M.blocksEstimate(ev.errors), false);
});

test('fuel and credit shortfalls are reported, not silently trimmed', () => {
  const poor = {...ctx, you: {...you, credits: 20, fuel: 3}};
  const ev = M.evaluate(draft(d => { d.allocation = {'0': 2, '1': 2}; d.bids[2] = '10'; }), poor);
  assert.match(ev.errors.fuel, /needs 6 fuel but your tank holds 3/);
  assert.match(ev.errors.credits, /reserves 22\.00 cr but you have 20\.00 cr/);
  assert.deepEqual(ev.plan.allocation, {'0': 2, '1': 2});
});

test('maximum buy respects round limit, holding limit and cent-rounded affordability', () => {
  const m = M.evaluate(M.emptyDraft(), {...ctx, you: {...you, credits: 50}}).maxima;
  assert.equal(m.cargo[0].buy, 2.042);
  assert.equal(m.cargo[0].why, 'what you can afford');
  assert.ok(M.round2(m.cargo[0].buy * 24 * 1.02) <= 50);
  assert.equal(m.shares[0].buy, 0);
  assert.equal(m.cargo[0].sell, 2.775);
  assert.equal(M.evaluate(M.emptyDraft(), ctx).maxima.shares[0].why, 'your holding limit');
});

test('disabled and recovery drones follow the rules', () => {
  const hurt = {...ctx, you: {...you, drones: [{...you.drones[0], disabled: true}, you.drones[1]]}};
  const ev = M.evaluate(draft(d => { d.allocation = {'0': 0, '1': 1}; }), hurt);
  assert.deepEqual(ev.plan.allocation, {'1': 1});
  assert.equal(ev.totals.disabled, 1);
  const rescue = {...ctx, you: {...you, recovery: true}};
  const r = M.evaluate(draft(d => { d.allocation = {'-1': 0}; d.bids[0] = '5'; }), rescue);
  assert.deepEqual(r.plan.allocation, {'-1': 0});
  assert.equal(r.totals.deployment, 0);
  assert.match(r.errors['bid-0'], /cannot bid/);
});

test('legacy signed drafts load into controls', () => {
  const d = M.normalizeDraft({allocation: {'0': 1}, bids: [0, 5, 0], commodity_orders: [0, -1.5, 0], stock_orders: [2, 0, 0], contracts: [true, false, false]});
  assert.deepEqual(d.cargo[1], {side: 'sell', qty: '1.5'});
  assert.deepEqual(d.shares[0], {side: 'buy', qty: '2'});
  assert.equal(M.normalizeDraft(null).bids.length, 3);
});

test('tied totals share a rank and the next rank is skipped', () => {
  const r = M.ranked([{seat: 0, networth: 1500}, {seat: 1, networth: 1600}, {seat: 2, networth: 1500.001}, {seat: 3, networth: 1400}]);
  assert.deepEqual(r.map(p => [p.seat, p.rank]), [[1, 1], [0, 2], [2, 2], [3, 4]]);
});

test('crew status is phase aware and never says planning after the match', () => {
  assert.equal(M.crewStatus({online: true, ready: false, locked: false}, 'finished').label, 'Match complete');
  assert.equal(M.crewStatus({online: true, locked: true}, 'planning').label, 'Plan locked');
  assert.equal(M.crewStatus({online: false, locked: false}, 'planning').label, 'Offline · seat held');
  assert.deepEqual(M.waitingFor([{name: 'A', online: true, ready: true}, {name: 'B', online: true, ready: false}], 'upgrade').map(p => p.name), ['B']);
});

test('component changes reconcile to the authoritative total in cents', () => {
  const before = {credits: 750, stocks: 0, salvage: 0, contracts: 0, fleet: 520};
  const after = {credits: 636, stocks: 98.2, salvage: 166.91, contracts: 0, fleet: 457.6};
  const r = M.reconcile(before, after, M.PUBLIC_KEYS, 88.71);
  assert.equal(r.total, 88.71);
  assert.equal(r.rounding, 0);
  assert.equal(M.reconcile(before, after, M.PUBLIC_KEYS, 88.72).rounding, .01);
});

test('market drivers do not single out one cause when several contributed', () => {
  assert.equal(M.drivers([-.06, 0, .001, 0], M.COMMODITY_TERMS).summary, 'Mostly supply vs demand');
  assert.match(M.drivers([-.06, 0, 0, .08], M.COMMODITY_TERMS).summary, /Several drivers; largest were market event and supply vs demand/);
});

test('formatting uses true minus signs and stable zero', () => {
  assert.equal(M.signedMoney(-12.5), '−12.50');
  assert.equal(M.signedMoney(0.004), '0.00');
  assert.equal(M.pct(-.0596), '−6.0%');
  assert.equal(M.pct(0), '0.0%');
});

test('timeline lists settlement and final results in order', () => {
  assert.deepEqual(M.timeline('planning', 2).map(s => s.state), ['done', 'current', 'upcoming', 'upcoming']);
  assert.equal(M.timeline('finished', 6).at(-1).label, 'Final results');
  assert.ok(M.timeline('finished', 6).every(s => s.state === 'done'));
});

test('price history uses only recorded quotes', () => {
  assert.deepEqual(M.priceSeries([], 'prices', 0), []);
  assert.deepEqual(M.priceSeries([{opening_prices: [24], prices: [25]}, {opening_prices: [25], prices: [23]}], 'prices', 0), [24, 25, 23]);
});
