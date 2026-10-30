"""Randomized games played through the Python GameService, recorded for the Worker to replay.

Every call's projection or error is recorded with the hidden rolls and tie-breaks it consumed.
usage: python tests/worker/server_cases.py [games] [seed]   (prints JSON)
"""
import json
import random
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import server.game as g  # noqa: E402
from simulation import economy as e  # noqa: E402


class Recorder:
    def __init__(self, rng):
        self.rng, self.calls = rng, []

    def log(self, method, args, value):
        self.calls.append(dict(method=method, args=args, value=value))
        return value

    def choice(self, seq):
        return self.log('choice', [list(seq)], self.rng.choice(seq))

    def choices(self, population, weights):
        return self.log('choices', [list(population), list(weights)], self.rng.choices(population, weights))

    def sample(self, population, k):
        return self.log('sample', [list(population), k], self.rng.sample(population, k))


class FrozenClock:
    @staticmethod
    def time():
        return 1_000_000.0


def you_player(you):
    return e.Player('human', 0, credits=you['credits'], fuel=you['fuel'], drones=[e.Drone(**d) for d in you['drones']],
                    inventory=you['inventory'], shares=you['shares'], extracted=you['extracted'], contracts=you['contracts'],
                    scanner=you['scanner'])


def random_plan(rng, state, valid):
    you, r = state['you'], g.RULES
    p = you_player(you)
    for _ in range(60):
        if you['recovery'] and rng.random() < .7:
            alloc = {-1: rng.choice([0, 0, 1])}
        else:
            ids = sorted(d['id'] for d in you['drones'] if not d['disabled'] or rng.random() < .1)
            alloc = {d: rng.randint(0, 2) for d in ids if rng.random() < .6}
            if rng.random() < .05:
                alloc[rng.choice([7, 42])] = 1
        bids = [rng.choice([0, 0, 0, rng.randint(1, 60), 125]) for _ in range(3)]
        corders = [rng.choice([0., 0., round(rng.uniform(-3, 3), rng.choice([0, 1, 3])), 5.])
                   for _ in range(3)]
        corders = [max(-4., min(4., q)) for q in corders]
        sorders = [rng.choice([0, 0, rng.randint(-2, 2), 3]) for _ in range(3)]
        pl = e.Plan(allocation=dict(sorted(alloc.items())), bids=bids, commodity_orders=corders, stock_orders=sorders,
                    contracts=[rng.random() < .3 for _ in range(3)])
        try:
            e.validate(p, pl, state['prices'], state['stocks'], r)
            ok = True
        except ValueError:
            ok = False
        if ok == valid or not valid:
            return dict(allocation={str(k): v for k, v in pl.allocation.items()}, bids=bids, commodity_orders=corders,
                        stock_orders=sorders, contracts=pl.contracts)
    return {}


def play(seed, steps):
    rng = random.Random(seed)
    svc = g.GameService(tempfile.mkdtemp(dir=ROOT / 'data') + '/rooms.db')
    counter = [0]

    def call(op, *args):
        try:
            if op == 'force':
                code, seat, updates = args
                with svc.store.transaction() as db:
                    room = svc.store.load(db, code)
                    room['members'][seat]['player'].update(updates)
                    svc.store.save(db, room)
                result = dict(ok=None)
            else:
                result = dict(ok=getattr(svc, op)(*args))
        except g.GameError as exc:
            result = dict(error=str(exc), status=exc.status)
        steps.append(dict(op=op, args=list(args), result=result))
        return result

    def raw(kind, state, **extra):
        counter[0] += 1
        return dict(kind=kind, request_id=f'q{seed}-{counter[0]}', round=state['round'], phase=state['phase'], **extra)

    n = rng.randint(2, 4)
    crew = [dict(name=f'Crew {seed}-{i}', key='%064x' % rng.getrandbits(256)) for i in range(n)]
    code = call('create', crew[0]['name'], crew[0]['key'])['ok']['code']
    call('create', crew[0]['name'], crew[0]['key'])
    for c in crew[1:]:
        call('join', code, c['name'], c['key'])
    call('join', code, crew[0]['name'].upper(), '%064x' % rng.getrandbits(256))
    call('join', 'NOROOM', 'Ghost', '%064x' % rng.getrandbits(256))
    call('join', code, crew[1]['name'], crew[1]['key'])
    if n == 4:
        call('join', code, 'Fifth', '%064x' % rng.getrandbits(256))
    call('view', code, 'f' * 64)
    state = call('view', code, crew[0]['key'])['ok']
    call('command', code, crew[-1]['key'], raw('start', state))
    call('command', code, crew[0]['key'], raw('start', state, bogus=1))
    call('command', code, crew[0]['key'], raw('start', state))
    last = {}
    while True:
        states = [call('view', code, c['key'])['ok'] for c in crew]
        phase = states[0]['phase']
        if phase == 'finished':
            break
        order = list(range(n))
        rng.shuffle(order)
        for i in order:
            c, state = crew[i], call('view', code, crew[i]['key'])['ok']
            for _ in range(rng.randint(0, 3)):
                action = rng.choice(['preview', 'scan', 'purchase', 'stale', 'retry', 'reuse', 'invalid-lock', 'ready'])
                if action == 'preview':
                    factor = rng.choice([0, 1, round(rng.uniform(0, 2), 3), 2.5])
                    call('preview', code, c['key'], random_plan(rng, state, rng.random() < .6), factor)
                elif action == 'scan':
                    call('command', code, c['key'], raw('scan', state, target=rng.choice(['hazard', 'event']), sector=rng.randint(0, 2)))
                elif action == 'purchase':
                    item = rng.choice(['fuel', 'drone', 'repair', 'insurance', 'scanner', 'retire'])
                    extra = dict(item=item)
                    if item == 'fuel':
                        extra['quantity'] = rng.randint(1, 9)
                    if item in ('repair', 'insurance', 'retire'):
                        extra['drone_id'] = rng.choice([d['id'] for d in state['you']['drones']] + [9])
                    last[i] = raw('purchase', state, **extra)
                    call('command', code, c['key'], last[i])
                elif action == 'stale':
                    call('command', code, c['key'], dict(raw('ready', state), round=max(0, state['round'] - 1)))
                elif action == 'retry' and i in last:
                    call('command', code, c['key'], last[i])
                elif action == 'reuse' and i in last:
                    call('command', code, c['key'], dict(last[i], item='scanner', quantity=1))
                elif action == 'invalid-lock':
                    call('command', code, c['key'], raw('lock', state, plan=random_plan(rng, state, False)))
                elif action == 'ready':
                    call('command', code, c['key'], raw('ready', state))
                state = call('view', code, c['key'])['ok']
            if phase == 'planning' and not state['you']['locked']:
                if rng.random() < .05 and state['you']['drones']:
                    call('force', code, i, dict(credits=0., fuel=0, inventory=[0., 0., 0.], shares=[0, 0, 0],
                                                  drones=[dict(d, disabled=True) for d in state['you']['drones']]))
                    state = call('view', code, c['key'])['ok']
                call('command', code, c['key'], raw('lock', state, plan=random_plan(rng, state, True)))
            elif phase in ('briefing', 'upgrade') and not state['you']['ready']:
                if rng.random() < .5:
                    call('command', code, c['key'], raw('purchase', state, item='fuel', quantity=rng.randint(1, 4)))
                    state = call('view', code, c['key'])['ok']
                call('command', code, c['key'], raw('ready', state))
    final = call('view', code, crew[0]['key'])['ok']
    call('command', code, crew[0]['key'], raw('ready', final))
    for c in crew:
        call('view', code, c['key'])
    return n


def main():
    games, seed = int(sys.argv[1]) if len(sys.argv) > 1 else 20, int(sys.argv[2]) if len(sys.argv) > 2 else 1
    (ROOT / 'data').mkdir(exist_ok=True)
    g.time = FrozenClock()
    out = []
    for k in range(games):
        recorder = Recorder(random.Random(seed * 7919 + k))
        g.RNG = recorder
        steps = []
        n = play(seed * 1000 + k, steps)
        out.append(dict(players=n, steps=steps, rng=recorder.calls))
    json.dump(out, sys.stdout)


if __name__ == '__main__':
    main()
