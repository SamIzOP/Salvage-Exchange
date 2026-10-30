"""Builds rooms in a chosen state through GameService on a local test server's database.

Never point this at real player data: it writes rooms directly.

Used only for browser checks of hard-to-reach states; the browser then drives the real HTTP UI.
usage: python fixture.py <db> <phase> [names...]   (prints JSON {code, players:[{name,key}]})
phases: lobby briefing planning lowfuel locked reveal final disabled recovery
"""
import json
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from server.game import GameService  # noqa: E402

db, phase, *names = sys.argv[1:]
names = names or ['Orion Salvage', 'Nova Works']
svc = GameService(db)
players = [dict(name=n, key=secrets.token_hex(32)) for n in names]
code = svc.create(players[0]['name'], players[0]['key'])['code']
for p in players[1:]:
    svc.join(code, p['name'], p['key'])
count = 0


def cmd(p, kind, **args):
    global count
    v = svc.view(code, p['key'])
    count += 1
    return svc.command(code, p['key'], dict(kind=kind, request_id=f'fx-{count}', round=v['round'], phase=v['phase'], **args))


def force(**changes):
    with svc.store.transaction() as tx:
        room = svc.store.load(tx, code)
        for k, v in changes.items():
            if k == 'player0':
                room['members'][0]['player'].update(v)
            else:
                room[k] = v
        svc.store.save(tx, room)


busy = dict(allocation={'0': 0, '1': 2}, bids=[0, 0, 7], commodity_orders=[1, 0, 0], stock_orders=[1, 0, 0])
if phase != 'lobby':
    cmd(players[0], 'start')
rounds = 6 if phase == 'final' else 1
for r in range(1, rounds + 1):
    if phase in ('lobby', 'briefing'):
        break
    if r > 1:
        for p, q in zip(players, [4, 3, 3, 3]):
            room = 16 - svc.view(code, p['key'])['you']['fuel']
            if room:
                cmd(p, 'purchase', item='fuel', quantity=min(q, room))
    if phase == 'disabled':
        force(hazards=[0., 1., 1.])
    if phase == 'recovery':
        force(player0=dict(credits=0, fuel=0, drones=[]))
        break
    for p in players:
        cmd(p, 'ready')
    if phase == 'lowfuel':
        force(player0=dict(fuel=2))
    if phase in ('planning', 'lowfuel'):
        break
    def working(p):
        return [d['id'] for d in svc.view(code, p['key'])['you']['drones'] if not d['disabled']]
    if phase == 'disabled':
        cmd(players[0], 'lock', plan=dict(allocation={'0': 0}))
    else:
        ids = working(players[0])
        you = svc.view(code, players[0]['key'])['you']
        buy = 1 if you['inventory'][0] <= 19 and you['credits'] > 150 else 0
        plan = dict(allocation={str(d): s for d, s in zip(ids, [0, 2])}, commodity_orders=[buy, 0, 0])
        if len(ids) > 1:
            plan['bids'] = [0, 0, 7]
        if r == 1:
            plan['stock_orders'] = [1, 0, 0]
        cmd(players[0], 'lock', plan=plan)
    if phase == 'locked':
        break
    for i, p in enumerate(players[1:]):
        ids = working(p)
        cmd(p, 'lock', plan=dict(allocation={str(ids[0]): (i + 1) % 3} if ids else {}))
    if r < rounds and phase == 'final':
        for p in players:
            cmd(p, 'ready')
print(json.dumps(dict(code=code, players=players)))
