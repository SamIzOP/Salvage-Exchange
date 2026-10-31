import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../web/engine/economy.js';
import {rules, runPython, diff} from './parity.mjs';

const COUNT = Number(process.env.SX_PARITY_CASES || 2500);
const {cases, sums} = runPython('tests/worker/economy_cases.py', [COUNT, process.env.SX_PARITY_SEED || 1]);
const plan = p => ({...structuredClone(p), allocation: p.allocation.map(([d, s]) => [d, s])});
const attempt = fn => {
  try { return {ok: fn() ?? null}; }
  catch (err) {
    if (err instanceof E.MissingDrone) return {missing: true};
    if (err instanceof E.EconomyError) return {error: err.message};
    throw err;
  }
};
const outcome = r => 'missing' in r ? {missing: true} : 'error' in r ? {error: r.error} : {ok: r.ok ?? null};

test(`sum() follows CPython's compensated float summation on ${sums.length} lists`, () => {
  for (const [i, c] of sums.entries()) assert.equal(E.pySum(c.values), c.result, `sum ${i}: ${JSON.stringify(c.values)}`);
});

test(`JavaScript economy matches Python on ${cases.length} randomized settlements`, () => {
  let settled = 0, invalid = 0, choices = 0;
  for (const [i, c] of cases.entries()) {
    const players = structuredClone(c.players);
    c.validate.forEach((expected, k) => {
      const got = attempt(() => E.validate(players[k], plan(c.plans[k]), c.prices, c.stocks, rules));
      assert.equal(diff(got, outcome(expected)), null, `case ${i} validate ${k}`);
      if ('error' in expected) invalid++;
    });
    players.forEach((p, k) => {
      assert.equal(diff(E.breakdown(p, c.prices, c.stocks, rules), c.breakdowns[k]), null, `case ${i} breakdown ${k}`);
      assert.equal(E.networth(p, c.prices, c.stocks, rules), c.networths[k], `case ${i} networth ${k}`);
      assert.equal(E.recoveryEligible(p, c.prices, c.stocks, rules), c.recovery[k], `case ${i} recovery ${k}`);
    });
    let k = 0;
    const rng = {choice(seq) { const call = c.choices[k++]; assert.equal(diff(seq, call.seq), null, `case ${i} tie-break pool`); choices++; return call.value; }};
    let got;
    try {
      const [prices, stocks, log] = E.settle(players, c.settle_plans.map(plan), c.prices, c.stocks, c.demand, c.hazards, c.events, rng, rules);
      got = {prices, stocks, log, players};
      settled++;
    } catch (err) {
      got = {error: `${err instanceof E.EconomyError ? 'ValueError' : 'AssertionError'}:${err.message}`};
    }
    if ('error' in c.settled) assert.equal(got.error?.split(':')[0], c.settled.error.split(':')[0], `case ${i} settle error`);
    else assert.equal(diff(got, c.settled), null, `case ${i} settle`);
    assert.equal(k, c.choices.length, `case ${i} consumed every tie-break`);
    const p = structuredClone(c.ops.start);
    for (const [s, step] of c.ops.steps.entries()) {
      const known = new Map();
      const fn = {fuel: () => E.buyFuel(p, step.arg, rules), drone: () => E.buyDrone(p, rules), repair: () => E.repair(p, step.arg, rules),
        insure: () => E.insure(p, step.arg, rules), scan: () => E.scan(p, step.arg, c.hazards, c.events, known, rules)}[step.op];
      assert.equal(diff(attempt(fn), outcome(step.result)), null, `case ${i} op ${s} ${step.op}`);
      assert.equal(diff(p, step.after), null, `case ${i} op ${s} state`);
      if (step.known) assert.equal(diff([...known.values()], step.known), null, `case ${i} op ${s} scan record`);
    }
  }
  assert.ok(settled > cases.length * .9, `most cases settle (${settled})`);
  assert.ok(invalid > cases.length * .5 && choices > 100, `invalid plans (${invalid}) and tie-breaks (${choices}) are exercised`);
});
