"""Randomized cases evaluated by the frozen Python economy, for the JavaScript port to match.

Prints JSON: a list of cases with inputs, recorded tie-break choices and the Python results.
usage: python tests/worker/economy_cases.py [count] [seed]
"""
import json
import random
import sys
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from simulation import economy as e  # noqa: E402

R = e.Rules.from_dict(json.loads((ROOT / 'simulation/rules-v0.2.json').read_text()))


class Recorder:
    """Tie-break chooser whose choices are replayed by the JavaScript side."""
    def __init__(self, rng):
        self.rng, self.calls = rng, []

    def choice(self, seq):
        value = self.rng.choice(seq)
        self.calls.append(dict(seq=list(seq), value=value))
        return value


def random_player(rng, n_drones=None):
    n_drones = rng.randint(0, 5) if n_drones is None else n_drones
    drones = [e.Drone(i, rng.choice([260., 228.8, 201.34, 177.18, 155.92, 0.]), rng.random() < .2, rng.random() < .2)
              for i in range(n_drones)]
    return e.Player('human', rng.randint(0, 3), credits=round(rng.uniform(0, 900), 2), fuel=rng.randint(0, 16), drones=drones,
                    inventory=[e.cargo(rng.uniform(0, x)) for x in (24, 14, 10)], shares=[rng.randint(0, 6) for _ in range(3)],
                    extracted=[e.cargo(rng.uniform(0, x)) for x in (30, 20, 12)], contracts=[rng.random() < .2 for _ in range(3)],
                    investment_flow=round(rng.uniform(-400, 200), 2), scanner=rng.random() < .3, next_drone_id=n_drones)


def random_plan(rng, p, sparse=False):
    alloc = {}
    for d in p.drones:
        if rng.random() < (.3 if sparse else .7):
            alloc[d.id] = rng.randint(0, 2)
    if rng.random() < .05:
        alloc[rng.choice([7, 99])] = 0
    if rng.random() < .03:
        alloc[0] = 3
    bids = [0 if rng.random() < .7 else rng.choice([rng.randint(1, 120), 0, 121, 5]) for _ in range(3)]
    corders = [0. if rng.random() < .5 else round(rng.uniform(-4.5, 4.5), rng.choice([0, 1, 3, 4])) for _ in range(3)]
    sorders = [0 if rng.random() < .5 else rng.randint(-3, 3) for _ in range(3)]
    return e.Plan(allocation=alloc, bids=bids, commodity_orders=corders, stock_orders=sorders,
                  contracts=[rng.random() < .3 for _ in range(3)])


def plan_json(pl):
    return dict(allocation=[[d, s] for d, s in pl.allocation.items()], bids=pl.bids, commodity_orders=pl.commodity_orders,
                stock_orders=pl.stock_orders, contracts=pl.contracts)


def market(rng, n):
    prices = [round(rng.uniform(b / 4, b * 4), 2) for b in R.base]
    stocks = [round(rng.uniform(25, 400), 2) for _ in range(3)]
    demand = [n * R.demand[j] * rng.choice([.8, 1., 1.2]) for j in range(3)]
    hazards = [rng.choice([1., .5, 0.]) for _ in range(3)]
    events = [rng.choice([-.08, 0., .08]) for _ in range(3)]
    return prices, stocks, demand, hazards, events


def attempt(fn):
    try:
        return dict(ok=fn())
    except ValueError as exc:
        return dict(error=str(exc))
    except StopIteration:
        return dict(missing=True)


def main():
    count, seed = int(sys.argv[1]) if len(sys.argv) > 1 else 3000, int(sys.argv[2]) if len(sys.argv) > 2 else 1
    rng = random.Random(seed)
    cases = []
    for i in range(count):
        n = rng.randint(2, 4)
        prices, stocks, demand, hazards, events = market(rng, n)
        players = [random_player(rng) for _ in range(n)]
        if rng.random() < .1:
            players[0] = e.Player('human', 0, credits=round(rng.uniform(0, 5), 2), fuel=0, drones=[], inventory=[0., 0., 0.], shares=[0, 0, 0])
        plans = [random_plan(rng, p, sparse=rng.random() < .5) for p in players]
        if not players[0].drones and rng.random() < .8:
            plans[0] = e.Plan(allocation={-1: rng.choice([0, 0, 0, 1])})
        before = [asdict(p) for p in players]
        case = dict(kind='settle', n=n, prices=prices, stocks=stocks, demand=demand, hazards=hazards, events=events,
                    players=before, plans=[plan_json(pl) for pl in plans])
        case['validate'] = [attempt(lambda p=p, pl=pl: list(e.validate(p, pl, prices, stocks, R))) for p, pl in zip(players, plans)]
        # Settle the plans that validate; replace the rest with sparse valid plans so most cases settle.
        for k, (p, pl) in enumerate(zip(players, plans)):
            if 'error' in case['validate'][k]:
                for _ in range(20):
                    candidate = random_plan(rng, p, sparse=True)
                    candidate.commodity_orders = [0., 0., 0.]
                    candidate.stock_orders = [0, 0, 0]
                    try:
                        e.validate(p, candidate, prices, stocks, R)
                        plans[k] = candidate
                        break
                    except ValueError:
                        continue
                else:
                    plans[k] = e.Plan()
        case['settle_plans'] = [plan_json(pl) for pl in plans]
        case['breakdowns'] = [e.breakdown(p, prices, stocks, R) for p in players]
        case['networths'] = [e.networth(p, prices, stocks, R) for p in players]
        case['recovery'] = [e.recovery_eligible(p, prices, stocks, R) for p in players]
        rec = Recorder(random.Random(seed * 100003 + i))
        try:
            newp, news, log = e.settle(players, plans, prices, stocks, demand, hazards, events, rec, R)
            case['settled'] = dict(prices=newp, stocks=news, log=log, players=[asdict(p) for p in players])
        except (ValueError, AssertionError) as exc:
            case['settled'] = dict(error=type(exc).__name__ + ':' + str(exc))
        case['choices'] = rec.calls
        # Upgrade-phase helpers on a fresh copy of the first player.
        ops = []
        p = e.Player(**{**before[0], 'drones': [e.Drone(**d) for d in before[0]['drones']]})
        for _ in range(6):
            op = rng.choice(['fuel', 'drone', 'repair', 'insure', 'scan'])
            if op == 'fuel':
                q = rng.randint(0, 17)
                ops.append(dict(op=op, arg=q, result=attempt(lambda: e.buy_fuel(p, q, R))))
            elif op == 'drone':
                ops.append(dict(op=op, result=attempt(lambda: e.buy_drone(p, R))))
            elif op in ('repair', 'insure'):
                d = rng.randint(0, 5)
                ops.append(dict(op=op, arg=d, result=attempt(lambda: (e.repair if op == 'repair' else e.insure)(p, d, R))))
            else:
                kind, j = rng.choice(['hazard', 'event']), rng.randint(0, 2)
                known = {}
                ops.append(dict(op=op, arg=[kind, j], result=attempt(lambda: e.scan(p, (kind, j), hazards, events, known, R)), known=[[k[0], k[1], v] for k, v in known.items()]))
            ops[-1]['after'] = asdict(p)
        case['ops'] = dict(start=before[0], steps=ops)
        cases.append(case)
    sums = []
    for _ in range(4000):
        k = rng.randint(0, 12)
        scale = rng.choice([1e-3, 1, 100, 1e6, 1e15])
        xs = [rng.choice([round(rng.uniform(-scale, scale), rng.randint(0, 6)), rng.uniform(-scale, scale), .1, -.1, 0.])
              for _ in range(k)]
        sums.append(dict(values=xs, result=sum(xs)))
    json.dump(dict(cases=cases, sums=sums), sys.stdout)


if __name__ == '__main__':
    main()
