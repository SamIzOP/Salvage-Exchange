import test from 'node:test';
import assert from 'node:assert/strict';
import {GameService, GameError} from '../../worker/src/game.js';
import {D1Store} from '../../worker/src/store.js';
import {D1} from './d1.mjs';
import {rules, runPython, diff, ReplayRng} from './parity.mjs';

const GAMES = Number(process.env.SX_PARITY_GAMES || 24);
const games = runPython('tests/worker/server_cases.py', [GAMES, process.env.SX_PARITY_SEED || 1]);

test(`Worker game service matches Python on ${games.length} recorded games`, async () => {
  let calls = 0, errors = 0, settled = 0;
  const kinds = new Set();
  for (const [g, game] of games.entries()) {
    const codes = [...new Set(game.steps.filter(s => s.op === 'create' && s.result.ok).map(s => s.result.ok.code))];
    const rng = new ReplayRng(game.rng), store = new D1Store(new D1());
    const service = new GameService(store, rules, {rng, clock: () => 1_000_000, code: () => codes.shift()});
    for (const [s, step] of game.steps.entries()) {
      let got;
      try {
        if (step.op === 'force') {
          const [code, seat, updates] = step.args, room = await store.load(code);
          Object.assign(room.members[seat].player, updates);
          await service.commit(room);
          got = {ok: null};
        } else got = {ok: await service[step.op](...step.args)};
      } catch (err) {
        if (!(err instanceof GameError)) throw err;
        got = {error: err.message, status: err.status};
      }
      const d = diff(got, step.result);
      assert.equal(d, null, `game ${g} step ${s} ${step.op} ${JSON.stringify(step.args).slice(0, 160)}`);
      calls++;
      if (step.result.error) { errors++; kinds.add(`${step.result.status} ${step.result.error}`); }
      if (step.op === 'command' && step.args[2].kind === 'lock' && step.result.ok?.history.length > 0) settled++;
    }
    assert.ok(rng.done(), `game ${g} consumed every recorded roll`);
  }
  console.log(`compared ${calls} calls (${errors} errors across ${kinds.size} distinct messages); locks with history: ${settled}`);
  assert.ok(kinds.size >= 15, `error paths exercised: ${[...kinds].join(' | ')}`);
});
