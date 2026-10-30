"""Authoritative orchestration over the unchanged frozen economic model."""
import hashlib
import json
import math
import random
import re
import secrets
import time
from dataclasses import asdict
from pathlib import Path

from pydantic import ValidationError
from simulation import economy as e
from .models import Command, Identity, PlanInput, PreviewInput
from .store import Store

ROOT = Path(__file__).resolve().parent.parent
RULES = e.Rules.from_dict(json.loads((ROOT / 'simulation/rules-v0.2.json').read_text()))
COMMODITIES = ['Alloys', 'Power Cores', 'Relic Tech']
SECTORS = ['Crystal Belt', 'Derelict Cruiser', 'Void Rift']
COMPANIES = ['Ferrum Industries', 'Helion Energy', 'Aether Research']
OBJECTIVES = ['Industrial Titan', 'Market Shark', 'Tech Pioneer', 'Logistics Empire']
RNG = random.SystemRandom()


class GameError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def require(ok, message, status=400):
    if not ok:
        raise GameError(message, status)


def player(member):
    data = {**member['player'], 'drones': [e.Drone(**d) for d in member['player']['drones']]}
    return e.Player(**data)


def plan(data):
    parsed = PlanInput.model_validate(data).model_dump()
    parsed['allocation'] = {int(k): v for k, v in parsed['allocation'].items()}
    return e.Plan(**parsed)


def digest(key):
    require(isinstance(key, str) and re.fullmatch('[a-f0-9]{64}', key), 'Invalid rejoin key', 401)
    return hashlib.sha256(key.encode()).hexdigest()


def price_audit(old, raw_return, floor, ceiling):
    capped = e.clamp(raw_return, -.25, .25)
    rounded = e.money(old * (1 + capped))
    lower = max(floor, math.ceil(old * .75 * 100 - 1e-7) / 100)
    upper = min(ceiling, math.floor(old * 1.25 * 100 + 1e-7) / 100)
    final = e.bounded_price(old, raw_return, floor, ceiling)
    return dict(raw_return=raw_return, capped_return=capped, rounded_quote=rounded,
                lower=lower, upper=upper, price=final, return_clipped=capped != raw_return, quote_clipped=rounded != final)


class GameService:
    def __init__(self, path):
        self.store = Store(path)

    def member(self, name):
        p = e.Player('human', 0, drones=[e.Drone(0, RULES.drone_cost), e.Drone(1, RULES.drone_cost)])
        return dict(name=name, player=asdict(p), ready=False, locked=False, plan=None,
                    scans=[], receipts={}, seen=time.time(), public_score=1270., public_fleet=2)

    def create(self, name, key):
        identity = Identity(name=name, rejoin_key=key)
        hashed = digest(key)
        with self.store.transaction() as db:
            previous = db.execute('SELECT code, seat FROM members WHERE digest=?', (hashed,)).fetchone()
            if previous:
                return self.project(self.store.load(db, previous[0]), previous[1])
            while True:
                code = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(6))
                if not self.store.load(db, code):
                    break
            room = dict(code=code, phase='lobby', round=0, version=1, prices=list(RULES.base),
                        stocks=[100.] * 3, demand=[0.] * 3, members=[self.member(identity.name)], history=[])
            self.store.save(db, room)
            db.execute('INSERT INTO members VALUES (?,?,?)', (hashed, code, 0))
            return self.project(room, 0)

    def join(self, code, name, key):
        identity = Identity(name=name, rejoin_key=key)
        with self.store.transaction() as db:
            room = self.store.load(db, code)
            require(room is not None, 'Room not found', 404)
            previous = db.execute('SELECT code,seat FROM members WHERE digest=?', (digest(key),)).fetchone()
            if previous:
                require(previous[0] == code, 'This key belongs to another room', 403)
                return self.project(room, previous[1])
            require(room['phase'] == 'lobby', 'Match already started; use your saved rejoin key', 409)
            require(len(room['members']) < 4, 'Room is full', 409)
            require(identity.name.casefold() not in [m['name'].casefold() for m in room['members']], 'Corporation name already in use')
            seat = len(room['members'])
            room['members'].append(self.member(identity.name))
            room['version'] += 1
            self.store.save(db, room)
            db.execute('INSERT INTO members VALUES (?,?,?)', (digest(key), code, seat))
            return self.project(room, seat)

    def authorized(self, db, code, key):
        match = db.execute('SELECT code,seat FROM members WHERE digest=?', (digest(key),)).fetchone()
        require(match is not None and match[0] == code, 'Rejoin key does not authorize this room', 401)
        room = self.store.load(db, code)
        require(room is not None, 'Room not found', 404)
        return room, match[1]

    def view(self, code, key):
        with self.store.transaction() as db:
            room, seat = self.authorized(db, code, key)
            room['members'][seat]['seen'] = time.time()
            self.store.save(db, room)
            return self.project(room, seat)

    def project(self, room, seat):
        m = room['members'][seat]
        p = player(m)
        own = {k: asdict(p)[k] for k in ['credits', 'fuel', 'drones', 'inventory', 'shares', 'extracted', 'contracts', 'scanner']}
        own.update(name=m['name'], seat=seat, ready=m['ready'], locked=m['locked'], plan=m['plan'],
                   scans=m['scans'], reports=m.get('reports', []),
                   objective=OBJECTIVES[p.objective] if room['round'] else None,
                   breakdown=e.breakdown(p, room['prices'], room['stocks'], RULES),
                   recovery=e.recovery_eligible(p, room['prices'], room['stocks'], RULES))
        result = dict(code=room['code'], phase=room['phase'], round=room['round'], version=room['version'],
                      prices=room['prices'], stocks=room['stocks'], demand=room['demand'], you=own,
                      rules=asdict(RULES), history=room['history'], players=[])
        for i, member in enumerate(room['members']):
            public = dict(seat=i, name=member['name'], host=i == 0, ready=member['ready'], locked=member['locked'],
                          online=time.time() - member['seen'] < 20, networth=member['public_score'], fleet=member['public_fleet'])
            if room['phase'] == 'finished':
                other = player(member)
                public.update(objective=OBJECTIVES[other.objective], breakdown=e.breakdown(other, room['prices'], room['stocks'], RULES))
                public['networth'] = e.networth(other, room['prices'], room['stocks'], RULES)
            result['players'].append(public)
        return result

    def prepare_round(self, room):
        room['round'] += 1
        room['phase'] = 'briefing'
        n = len(room['members'])
        room['demand'] = [n * RULES.demand[j] * RNG.choices([.8, 1., 1.2], [1, 2, 1])[0] for j in range(3)]
        room['hazards'] = [RNG.choices([1., .5, 0.], [RULES.clear[j], RULES.disruption[j], max(0, 1 - RULES.clear[j] - RULES.disruption[j])])[0] for j in range(3)]
        room['events'] = [RNG.choices([-.08, 0., .08], [1, 3, 1])[0] for _ in range(3)]
        for m in room['members']:
            m.update(ready=False, locked=False, plan=None, scans=[])

    def command(self, code, key, raw):
        try:
            cmd = Command.model_validate(raw)
            fingerprint = hashlib.sha256(json.dumps(cmd.model_dump(), sort_keys=True).encode()).hexdigest()
            with self.store.transaction() as db:
                room, seat = self.authorized(db, code, key)
                m = room['members'][seat]
                receipt = m['receipts'].get(cmd.request_id)
                if receipt:
                    require(receipt == fingerprint, 'Request ID already used for a different action', 409)
                    return self.project(room, seat)
                require(room['round'] == cmd.round and room['phase'] == cmd.phase, 'The phase changed. Refresh and try again.', 409)
                require(room['phase'] != 'finished', 'Match is complete', 409)
                require(len(m['receipts']) < 2000, 'Action limit reached', 429)
                if cmd.kind == 'start':
                    require(seat == 0 and room['phase'] == 'lobby', 'Only the host can start from the lobby', 403)
                    require(2 <= len(room['members']) <= 4, 'At least two corporations are required')
                    objectives = RNG.sample(range(4), len(room['members']))
                    for member, objective in zip(room['members'], objectives):
                        member['player']['objective'] = objective
                    self.prepare_round(room)
                elif cmd.kind == 'ready':
                    require(room['phase'] in ['briefing', 'upgrade'], 'Not an acknowledgement phase', 409)
                    require(not m['ready'], 'Already ready', 409)
                    m['ready'] = True
                    if all(x['ready'] for x in room['members']):
                        if room['phase'] == 'briefing':
                            room['phase'] = 'planning'
                            for member in room['members']:
                                member['ready'] = False
                        else:
                            self.prepare_round(room)
                elif cmd.kind == 'lock':
                    require(room['phase'] == 'planning' and not m['locked'], 'Plan cannot be changed in this phase', 409)
                    require(cmd.plan is not None, 'A plan is required')
                    submitted = plan(cmd.plan.model_dump())
                    e.validate(player(m), submitted, room['prices'], room['stocks'], RULES)
                    m.update(plan=cmd.plan.model_dump(), locked=True)
                    if all(x['locked'] for x in room['members']):
                        self.resolve(room)
                else:
                    require(not m['ready'] and not m['locked'], 'Already committed; wait for the next phase', 409)
                    p = player(m)
                    if cmd.kind == 'scan':
                        require(room['phase'] == 'briefing', 'Scans are purchased during briefing', 409)
                        knowledge = {(x['target'], x['sector']): x['value'] for x in m['scans']}
                        e.scan(p, (cmd.target, cmd.sector), room['hazards'], room['events'], knowledge, RULES)
                        m['scans'] = [dict(target=k[0], sector=k[1], value=v) for k, v in knowledge.items()]
                    elif cmd.kind == 'purchase':
                        self.purchase(room, p, cmd)
                    m['player'] = asdict(p)
                m['receipts'][cmd.request_id] = fingerprint
                m['seen'] = time.time()
                room['version'] += 1
                self.store.save(db, room)
                return self.project(room, seat)
        except (ValidationError, ValueError, StopIteration) as exc:
            if isinstance(exc, GameError):
                raise
            raise GameError(str(exc) if not isinstance(exc, (ValidationError, StopIteration)) else 'Invalid action or unavailable drone') from exc

    def purchase(self, room, p, cmd):
        require(room['phase'] in ['briefing', 'upgrade'], 'Purchases are closed', 409)
        if room['phase'] == 'briefing' and cmd.item != 'fuel':
            require(cmd.item in ['repair', 'drone'] and not any(not d.disabled for d in p.drones), 'Only recovery repairs or replacement are allowed in briefing')
            require(cmd.item != 'drone' or not p.drones, 'Repair your disabled fleet first')
            cost = RULES.repair_cost if cmd.item == 'repair' else RULES.drone_cost
            require(p.credits >= cost + RULES.deploy_cost + (0 if p.fuel else RULES.fuel_cost), 'Recovery purchase must leave enough credits for a Belt launch')
        if cmd.item == 'fuel':
            e.buy_fuel(p, cmd.quantity, RULES)
        elif cmd.item == 'drone':
            e.buy_drone(p, RULES)
        elif cmd.item == 'repair':
            e.repair(p, cmd.drone_id, RULES)
        elif cmd.item == 'insurance':
            e.insure(p, cmd.drone_id, RULES)
        elif cmd.item == 'scanner':
            require(not p.scanner and p.credits >= RULES.scanner_cost, 'Scanner unavailable or insufficient credits')
            p.credits = e.money(p.credits - RULES.scanner_cost)
            p.scanner = True
        elif cmd.item == 'retire':
            require(any(d.id == cmd.drone_id for d in p.drones), 'Drone not found')
            p.drones = [d for d in p.drones if d.id != cmd.drone_id]
        else:
            raise GameError('Choose an upgrade')

    def resolve(self, room):
        players = [player(m) for m in room['members']]
        plans = [plan(m['plan']) for m in room['members']]
        before = [e.breakdown(p, room['prices'], room['stocks'], RULES) for p in players]
        fleets = [[asdict(d) for d in p.drones] for p in players]
        contracts = [list(p.contracts) for p in players]
        prices, stocks, log = e.settle(players, plans, room['prices'], room['stocks'], room['demand'], room['hazards'], room['events'], RNG, RULES)
        log.update(round=room['round'], opening_prices=room['prices'], opening_stocks=room['stocks'],
                   prices=prices, stocks=stocks, demand=room['demand'], plans=[asdict(p) for p in plans], scores=[], deltas=[])
        log['commodity_audit'] = [price_audit(room['prices'][j], sum(log['commodity_terms'][j]), RULES.base[j]/4, RULES.base[j]*4) for j in range(3)]
        log['stock_audit'] = [price_audit(room['stocks'][j], sum(log['stock_terms'][j]['components']), 25, 400) for j in range(3)]
        for seat, (m, p, old) in enumerate(zip(room['members'], players, before)):
            m['player'] = asdict(p)
            current = e.breakdown(p, prices, stocks, RULES)
            public = {k: v for k, v in current.items() if k != 'objective'}
            log['scores'].append(public)
            log['deltas'].append(e.money(sum(public.values()) - sum(v for k, v in old.items() if k != 'objective')))
            m.setdefault('reports', []).append(self.report(seat, plans[seat], old, current, fleets[seat], contracts[seat], p, log))
            m.update(public_score=e.money(sum(public.values())), public_fleet=len(p.drones), ready=False, locked=False)
        room.update(prices=prices, stocks=stocks, phase='finished' if room['round'] == 6 else 'upgrade')
        room['history'].append(log)

    @staticmethod
    def report(seat, pl, before, after, fleet, contracts, p, log):
        """The owner's own settlement accounting, recorded for the reveal and never projected to rivals.

        Everything here restates what settlement already did; it changes no balances.
        """
        trades = []
        for kind, orders, quotes in (('cargo', pl.commodity_orders, log['opening_prices']),
                                     ('shares', pl.stock_orders, log['opening_stocks'])):
            for j, q in enumerate(orders):
                if q:
                    notional = e.money(abs(q) * quotes[j])
                    cash = -e.money(q * quotes[j] * (1 + RULES.fee)) if q > 0 else e.money(-q * quotes[j] * (1 - RULES.fee))
                    trades.append(dict(kind=kind, asset=j, quantity=q, price=quotes[j], notional=notional,
                                       fee=e.money(abs(abs(cash) - notional)), cash=cash))
        normal = [(d, s) for d, s in pl.allocation.items() if d != -1]
        insured = {d['id'] for d in fleet if d['insured']}
        hits = []
        for j in range(3):
            ids = [d for d, s in normal if s == j]
            if log['hazards'][j] == 0 and ids and log['access'][j] in (None, seat):
                hits.append(dict(drone=min(ids), sector=j, repaired=min(ids) in insured))
        # Split the fleet score change into book depreciation and disabled-status changes, both on score basis.
        weight = lambda disabled: .25 if disabled else 1.
        later = {d.id: d for d in p.drones}
        depreciation = sum(weight(d['disabled']) * (d['value'] - later[d['id']].value) for d in fleet)
        disabling = sum((weight(later[d['id']].disabled) - weight(d['disabled'])) * later[d['id']].value for d in fleet)
        return dict(round=log['round'], before=before, after=after, trades=trades,
                    trade_cash=e.money(sum(t['cash'] for t in trades)),
                    deployment=e.money(RULES.deploy_cost * len(normal)),
                    fuel=sum(RULES.fuel_use[s] for _, s in normal),
                    bid_paid=sum(pl.bids[j] for j in range(3) if log['access'][j] == seat),
                    hits=hits, contracts=[j for j in range(3) if p.contracts[j] and not contracts[j]],
                    depreciation=e.money(depreciation), disabling=e.money(disabling))

    def preview(self, code, key, raw, rival_factor):
        try:
            request = PreviewInput(plan=raw, rival_factor=rival_factor)
            pl = plan(request.plan.model_dump())
        except (ValueError, ValidationError) as exc:
            raise GameError('Invalid preview inputs') from exc
        with self.store.transaction() as db:
            room, seat = self.authorized(db, code, key)
            require(room['phase'] in ['briefing', 'planning'], 'Preview is available before resolution', 409)
            m = room['members'][seat]
            p = player(m)
            n = len(room['members'])
            knowledge = {(x['target'], x['sector']): x['value'] for x in m['scans']}
            desired = [(n - 1) * RULES.demand[j] * request.rival_factor for j in range(3)]
            means = [RULES.clear[j] + .5 * RULES.disruption[j] for j in range(3)]
            hazard = [knowledge.get(('hazard', j), means[j]) for j in range(3)]
            events = [knowledge.get(('event', j), 0.) for j in range(3)]
            scenarios = []
            for mode in ['shared', 'access_won', 'access_lost']:
                own, rivals = [], []
                for j in range(3):
                    emergency = pl.allocation.get(-1) == j
                    cap = sum(RULES.capacity[j] * (.5 if d == -1 else 1) for d, s in pl.allocation.items() if s == j)
                    rival = desired[j] / means[j]
                    reserve = n * RULES.reserve[j]
                    protected = cap if emergency else 0
                    available = reserve - protected
                    total = cap + rival
                    if emergency:
                        mine, others = cap, min(rival, available)
                    elif pl.bids[j] and mode == 'access_won':
                        mine, others = min(cap, reserve), 0
                    elif pl.bids[j] and mode == 'access_lost':
                        mine, others = 0, min(rival, reserve)
                    else:
                        mine = min(cap, reserve * cap / total) if total else 0
                        others = min(rival, reserve * rival / total) if total else 0
                    own.append(e.cargo(mine * hazard[j]))
                    rivals.append(e.cargo(others * hazard[j]))
                supply = [a + b for a, b in zip(own, rivals)]
                prices, terms = e.commodity_update(room['prices'], supply, pl.commodity_orders, room['demand'], events, RULES)
                stocks, _ = e.stock_update(room['stocks'], prices, supply, pl.stock_orders, n, RULES)
                scenarios.append(dict(mode=mode, personal=own, rival_supply=rivals, total_supply=supply,
                                      projected_prices=prices, projected_stocks=stocks, terms=terms,
                                      salvage_value=[e.money(a * b) for a, b in zip(own, prices)]))
            error, fuel, reserved = None, 0, 0
            try:
                fuel, reserved = e.validate(p, pl, room['prices'], room['stocks'], RULES)
            except ValueError as exc:
                error = str(exc)
            return dict(**scenarios[0], scenarios=scenarios, estimate=True, error=error, fuel=fuel, reserved=reserved,
                        contract_cost=[e.money(a * b) for a, b in zip(RULES.contract_qty, room['prices'])])
