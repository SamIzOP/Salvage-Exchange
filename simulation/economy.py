"""Deterministic, standard-library economic model for SALVAGE EXCHANGE.

This is an offline simulator, not the multiplayer game or its security boundary.
Run simulation/run.py and simulation/test_economy.py from the workspace root.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace
import itertools
import math
import random


def clamp(x, lo, hi):
    return min(hi, max(lo, x))


def money(x):
    return math.floor(x * 100 + 0.500000001) / 100


def cargo(x):
    return math.floor(x * 1000 + 0.00000001) / 1000


@dataclass(frozen=True)
class Rules:
    version: str = '0.1'
    base: tuple = (24., 42., 72.)
    demand: tuple = (3., 1.5, .75)
    capacity: tuple = (4., 3., 2.5)
    reserve: tuple = (3., 2., 1.5)
    clear: tuple = (.85, .65, .45)
    disruption: tuple = (.15, .25, .35)
    fuel_use: tuple = (1, 2, 3)
    fuel_cost: float = 8.
    deploy_cost: float = 6.
    drone_cost: float = 180.
    depreciation: float = .12
    repair_cost: float = 30.
    insurance_cost: float = 12.
    scan_cost: float = 20.
    scanner_cost: float = 70.
    upgraded_scan_cost: float = 10.
    fleet_limit: int = 5
    fee: float = .02
    bid_min: int = 1
    bid_max: int = 120
    commodity_trade: tuple = (4., 2., 1.)
    commodity_position: tuple = (20., 12., 8.)
    stock_trade: int = 2
    stock_position: int = 6
    supply_signal: float = .12
    trade_signal: float = .04
    commodity_pull: float = .06
    event_size: float = .08
    company_output_link: float = .5
    company_cost: tuple = (14., 25., 44.)
    company_fixed: tuple = (6., 5., 4.)
    stock_profit_signal: float = .10
    stock_trade_signal: float = .02
    stock_pull: float = .04
    contract_qty: tuple = (6., 3., 2.)
    contract_score: tuple = (165., 145., 165.)
    objective_cap: float = 120.
    titan_rate: float = 5.
    shark_rate: float = .30
    pioneer_rate: float = 20.
    logistics_rate: float = 40.
    protected_recovery: bool = False

    @classmethod
    def from_dict(cls, data):
        defaults = cls()
        return cls(**{k: tuple(v) if isinstance(getattr(defaults, k), tuple) else v
                      for k, v in data.items()})


@dataclass
class Drone:
    id: int
    value: float
    disabled: bool = False
    insured: bool = False


@dataclass
class Player:
    policy: str
    objective: int
    credits: float = 750.
    fuel: int = 8
    drones: list = field(default_factory=lambda: [Drone(0, 180.), Drone(1, 180.)])
    inventory: list = field(default_factory=lambda: [0., 0., 0.])
    shares: list = field(default_factory=lambda: [0, 0, 0])
    extracted: list = field(default_factory=lambda: [0., 0., 0.])
    contracts: list = field(default_factory=lambda: [False, False, False])
    investment_flow: float = 0.
    scanner: bool = False
    next_drone_id: int = 2
    scan_spend: float = 0.
    bid_spend: float = 0.
    deployment_spend: float = 0.
    insurance_spend: float = 0.


@dataclass
class Plan:
    # IDs >= 0 are owned drones; -1 denotes the temporary recovery drone.
    allocation: dict = field(default_factory=dict)
    bids: list = field(default_factory=lambda: [0, 0, 0])
    commodity_orders: list = field(default_factory=lambda: [0., 0., 0.])
    stock_orders: list = field(default_factory=lambda: [0, 0, 0])
    contracts: list = field(default_factory=lambda: [False, False, False])


def objective_bonus(p, stocks, r):
    if p.objective == 0:
        raw = r.titan_rate * p.extracted[0]
    elif p.objective == 1:
        raw = r.shark_rate * max(0., p.investment_flow + sum(a*b for a,b in zip(p.shares, stocks)))
    elif p.objective == 2:
        raw = r.pioneer_rate * p.extracted[2]
    else:
        raw = r.logistics_rate * sum(p.contracts)
    return money(min(r.objective_cap, raw))


def breakdown(p, prices, stocks, r):
    return dict(credits=p.credits,
                stocks=money(sum(a*b for a,b in zip(p.shares, stocks))),
                salvage=money(sum(a*b for a,b in zip(p.inventory, prices))),
                contracts=money(sum(v for done,v in zip(p.contracts, r.contract_score) if done)),
                fleet=money(sum(d.value * (.25 if d.disabled else 1.) for d in p.drones)),
                objective=objective_bonus(p, stocks, r))


def networth(p, prices, stocks, r):
    return money(sum(breakdown(p, prices, stocks, r).values()))


def recovery_eligible(p, prices, stocks, r):
    liquid = p.credits + sum(x*y for x,y in zip(p.inventory, prices))*(1-r.fee)
    liquid += sum(x*y for x,y in zip(p.shares, stocks))*(1-r.fee)
    launch = r.deploy_cost + (0 if p.fuel >= 1 else r.fuel_cost)
    if any(not d.disabled for d in p.drones):
        return liquid + 1e-8 < launch
    restore = r.repair_cost if p.drones else r.drone_cost
    return liquid + 1e-8 < restore + launch


def bounded_price(old, rate, lo, hi):
    # Respect the percentage cap *after* rounding to cents as well.
    upper = math.floor(old * 1.25 * 100 + 1e-7) / 100
    lower = math.ceil(old * .75 * 100 - 1e-7) / 100
    return clamp(money(old*(1+clamp(rate, -.25, .25))), max(lo, lower), min(hi, upper))


def commodity_update(prices, extraction, nettrade, demand, events, r):
    result, terms = [], []
    for j, old in enumerate(prices):
        components = [r.supply_signal*clamp((demand[j]-extraction[j])/demand[j], -1, 1),
                      r.trade_signal*clamp(nettrade[j]/demand[j], -1, 1),
                      r.commodity_pull*(r.base[j]/old-1), events[j]]
        result.append(bounded_price(old, sum(components), r.base[j]/4, r.base[j]*4))
        terms.append(components)
    return result, terms


def stock_update(stocks, prices, extraction, nettrade, n, r):
    result, terms = [], []
    for j, old in enumerate(stocks):
        output = r.demand[j] + r.company_output_link*extraction[j]/n
        profit = output*(prices[j]-r.company_cost[j])-r.company_fixed[j]
        baseline = (1+r.company_output_link)*r.demand[j]*(r.base[j]-r.company_cost[j])-r.company_fixed[j]
        components = [r.stock_profit_signal*clamp((profit-baseline)/max(20, abs(baseline)), -1.5, 1.5),
                      r.stock_trade_signal*clamp(nettrade[j]/(2*n), -1, 1),
                      r.stock_pull*(100/old-1)]
        result.append(bounded_price(old, sum(components), 25, 400))
        terms.append(dict(output=output, profit=profit, baseline=baseline, components=components))
    return result, terms


def validate(p, plan, prices, stocks, r):
    def require(ok, reason):
        if not ok:
            raise ValueError(reason)
    require(len(plan.bids) == len(plan.commodity_orders) == len(plan.stock_orders) == len(plan.contracts) == 3,
            'invalid order length')
    emergency = -1 in plan.allocation
    owned = {d.id: d for d in p.drones}
    require(not emergency or len(plan.allocation) == 1, 'recovery drone cannot join normal fleet')
    require(not emergency or recovery_eligible(p, prices, stocks, r), 'ineligible recovery drone')
    require(not emergency or not r.protected_recovery or plan.allocation[-1] == 0,
            'protected recovery is Belt-only')
    fuel, spend = 0, 0.
    for drone, sector in plan.allocation.items():
        require(type(sector) is int and 0 <= sector < 3, 'invalid sector')
        if drone != -1:
            require(drone in owned and not owned[drone].disabled, 'unavailable drone')
            fuel += r.fuel_use[sector]
            spend += r.deploy_cost
    for j in range(3):
        b = plan.bids[j]
        require(type(b) is int and (b == 0 or r.bid_min <= b <= r.bid_max), 'invalid bid')
        require(not b or j in plan.allocation.values(), 'bid without capacity')
        require(not emergency or b == 0, 'recovery drone cannot bid')
        spend += b
        for order, limit, held, position, price, is_stock in [
            (plan.commodity_orders[j], r.commodity_trade[j], p.inventory[j], r.commodity_position[j], prices[j], False),
            (plan.stock_orders[j], r.stock_trade, p.shares[j], r.stock_position, stocks[j], True)]:
            require(isinstance(order, (int, float)) and math.isfinite(order), 'non-finite order')
            require(not is_stock or type(order) is int, 'fractional shares')
            require(is_stock or abs(order*1000-round(order*1000)) < 1e-6, 'cargo precision')
            require(abs(order) <= limit+1e-8, 'order limit')
            require(order >= -held-1e-8, 'short sale')
            require(order <= 0 or held+order <= position+1e-8, 'position limit')
            if order > 0:
                spend += money(order*price*(1+r.fee))
    require(fuel <= p.fuel, 'insufficient fuel')
    require(money(spend) <= p.credits+1e-8, 'insufficient reserved credits')
    return fuel, money(spend)


def settle(players, plans, prices, stocks, demand, hazards, events, rng, r):
    n = len(players)
    # Validate every plan before any state mutation.
    reserved = [validate(p, plan, prices, stocks, r) for p,plan in zip(players, plans)]
    netcargo, netstock, extracted = [0.]*3, [0]*3, [0.]*3
    gained = [[0.]*3 for _ in players]
    credits_before = sum(p.credits for p in players)
    credit_delta = 0.
    recovery_count = 0
    for p, plan, (fuel, _) in zip(players, plans, reserved):
        p.fuel -= fuel
        deployment = r.deploy_cost * sum(d != -1 for d in plan.allocation)
        p.credits = money(p.credits-deployment)
        p.deployment_spend += deployment
        credit_delta -= deployment
        recovery_count += -1 in plan.allocation
        for j in range(3):
            for orders, holdings, quote, net, stock in [(plan.commodity_orders, p.inventory, prices, netcargo, False),
                                                       (plan.stock_orders, p.shares, stocks, netstock, True)]:
                q = orders[j]
                change = -money(q*quote[j]*(1+r.fee)) if q >= 0 else money(-q*quote[j]*(1-r.fee))
                p.credits = money(p.credits+change)
                credit_delta += change
                holdings[j] = holdings[j]+q if stock else cargo(holdings[j]+q)
                net[j] += q
                if stock:
                    p.investment_flow = money(p.investment_flow+change)
    access = []
    for j in range(3):
        caps = [sum(r.capacity[j]*(.5 if d == -1 else 1.) for d,s in pl.allocation.items() if s == j) for pl in plans]
        emergency_seats = [i for i,pl in enumerate(plans) if r.protected_recovery and pl.allocation.get(-1) == j]
        protected_capacity = sum(caps[i] for i in emergency_seats)
        remaining_reserve = n*r.reserve[j]-protected_capacity
        normal_capacity = sum(c for i,c in enumerate(caps) if i not in emergency_seats)
        bidders = [i for i,pl in enumerate(plans) if pl.bids[j] > 0]
        winner = None
        if bidders:
            highest = max(plans[i].bids[j] for i in bidders)
            winner = rng.choice([i for i in bidders if plans[i].bids[j] == highest])
            players[winner].credits = money(players[winner].credits-highest)
            players[winner].bid_spend += highest
            credit_delta -= highest
        access.append(winner)
        for i,(p,pl) in enumerate(zip(players, plans)):
            if caps[i] == 0 or (winner is not None and winner != i and i not in emergency_seats):
                continue
            if i in emergency_seats:
                raw = caps[i]
            else:
                raw = min(caps[i], remaining_reserve if winner is not None else remaining_reserve*caps[i]/normal_capacity)
            q = cargo(raw*hazards[j])
            p.inventory[j] = cargo(p.inventory[j]+q)
            p.extracted[j] = cargo(p.extracted[j]+q)
            extracted[j] += q
            gained[i][j] = q
            if hazards[j] == 0:
                ids = [d for d,s in pl.allocation.items() if s == j and d != -1]
                if ids:
                    next(d for d in p.drones if d.id == min(ids)).disabled = True
    newprices, commodity_terms = commodity_update(prices, extracted, netcargo, demand, events, r)
    newstocks, stock_terms = stock_update(stocks, newprices, extracted, netstock, n, r)
    for p,pl in zip(players, plans):
        for j in range(3):
            if pl.contracts[j] and not p.contracts[j] and p.inventory[j]+1e-8 >= r.contract_qty[j]:
                p.inventory[j] = cargo(p.inventory[j]-r.contract_qty[j])
                p.contracts[j] = True
        for d in p.drones:
            if d.insured:
                d.disabled = False
            d.insured = False
            d.value = money(d.value*(1-r.depreciation))
        assert p.credits >= 0 and p.fuel >= 0
        assert all(q >= 0 for q in p.inventory) and all(0 <= q <= r.stock_position for q in p.shares)
    assert abs(sum(p.credits for p in players)-credits_before-credit_delta) < .001, 'credit ledger mismatch'
    for j in range(3):
        assert extracted[j] <= n*r.reserve[j]+1e-7, 'sector reserve exceeded'
        assert .75-1e-8 <= newprices[j]/prices[j] <= 1.25+1e-8
        assert .75-1e-8 <= newstocks[j]/stocks[j] <= 1.25+1e-8
    return newprices, newstocks, dict(extraction=extracted, netcargo=netcargo, netstock=netstock,
        hazards=hazards, events=events, access=access, gains=gained,
        allocations=[list(pl.allocation.values()) for pl in plans], bids=[pl.bids[:] for pl in plans],
        commodity_terms=commodity_terms, stock_terms=stock_terms, recovery=recovery_count)


def scan(p, target, hidden_hazards, hidden_events, purchased, r):
    if target in purchased or len(purchased) >= 2:
        raise ValueError('scan target already bought or scan limit')
    kind, j = target
    if kind not in ('hazard', 'event') or j not in (0, 1, 2):
        raise ValueError('invalid scan target')
    cost = r.upgraded_scan_cost if p.scanner else r.scan_cost
    if p.credits < cost:
        raise ValueError('unaffordable scan')
    p.credits = money(p.credits-cost)
    p.scan_spend += cost
    purchased[target] = (hidden_hazards if kind == 'hazard' else hidden_events)[j]


def buy_drone(p, r):
    if len(p.drones) >= r.fleet_limit or p.credits < r.drone_cost:
        raise ValueError('unavailable drone purchase')
    p.credits = money(p.credits-r.drone_cost)
    p.drones.append(Drone(p.next_drone_id, r.drone_cost))
    p.next_drone_id += 1


def buy_fuel(p, qty, r):
    if type(qty) is not int or qty < 0 or p.fuel+qty > 16 or p.credits+1e-8 < qty*r.fuel_cost:
        raise ValueError('invalid fuel purchase')
    p.credits = money(p.credits-qty*r.fuel_cost)
    p.fuel += qty


def repair(p, drone_id, r):
    d = next(d for d in p.drones if d.id == drone_id)
    if not d.disabled or p.credits < r.repair_cost:
        raise ValueError('invalid repair')
    p.credits = money(p.credits-r.repair_cost)
    d.disabled = False


def insure(p, drone_id, r):
    d = next(d for d in p.drones if d.id == drone_id)
    if d.insured or d.disabled or p.credits < r.insurance_cost:
        raise ValueError('invalid insurance')
    p.credits = money(p.credits-r.insurance_cost)
    p.insurance_spend += r.insurance_cost
    d.insured = True


POLICIES = ('heavy_extractor', 'safe_hauler', 'scanner_heavy', 'pure_trader', 'random')


def public_observation(round_no, n, prices, stocks, demand, history):
    # Explicit allowlist: no current plans, objectives, hazards or events.
    return dict(round=round_no, n=n, prices=prices[:], stocks=stocks[:], demand=demand[:], history=history)


def predict(p, obs, knowledge, r, own_extraction=None, own_trade=None):
    last = obs['history'][-1] if obs['history'] else None
    n = obs['n']
    expected = [n*r.demand[j] if last is None else .6*last['extraction'][j]+.4*n*r.demand[j] for j in range(3)]
    if own_extraction is not None:
        expected = [expected[j]*(n-1)/n+own_extraction[j] for j in range(3)]
    events = [knowledge.get(('event', j), 0.) for j in range(3)]
    prices, _ = commodity_update(obs['prices'], expected, own_trade or [0.,0.,0.], obs['demand'], events, r)
    stocks, _ = stock_update(obs['stocks'], prices, expected, [0,0,0], n, r)
    return prices, stocks


def scan_targets(p, obs, rng, r):
    if p.policy in ('scanner_heavy', 'scanner_no_scan'):
        return [] if p.policy == 'scanner_no_scan' else [('hazard', 2), ('hazard', 1)]
    if p.policy == 'random' and rng.random() < .15:
        return [('hazard', rng.randrange(3))]
    return []


def prepare(p, obs, rng, r):
    # Briefing recovery repairs only when no functional drone remains.
    if not p.drones and p.policy != 'pure_trader':
        cost = r.drone_cost+r.deploy_cost+(0 if p.fuel else r.fuel_cost)
        if p.credits >= cost:
            buy_drone(p, r)
    if not any(not d.disabled for d in p.drones) and p.drones and p.policy != 'pure_trader':
        cost = r.repair_cost+r.deploy_cost+(0 if p.fuel else r.fuel_cost)
        if p.credits >= cost:
            repair(p, p.drones[0].id, r)
    if p.policy == 'pure_trader':
        return
    active = sum(not d.disabled for d in p.drones)
    target = min(16, active*(2 if p.policy == 'safe_hauler' else 3))
    affordable = max(0, int((p.credits-active*r.deploy_cost-30)/r.fuel_cost))
    buy_fuel(p, max(0, min(target-p.fuel, affordable)), r)


def make_plan(p, obs, knowledge, rng, r):
    """Policies receive own state, public history, and purchased scan results only."""
    plan = Plan()
    prices, stocks = obs['prices'], obs['stocks']
    mode = p.policy
    base_mode = 'scanner_heavy' if mode == 'scanner_no_scan' else mode
    budget = p.credits
    fuel = p.fuel
    last = obs['history'][-1] if obs['history'] else None
    hazard_mean = [knowledge.get(('hazard', j), r.clear[j]+.5*r.disruption[j]) for j in range(3)]
    active = [d.id for d in p.drones if not d.disabled]
    if recovery_eligible(p, prices, stocks, r):
        active = [-1]
    if base_mode in ('pure_trader', 'hoarder', 'pump_trader'):
        active = []
    counts = [0,0,0]
    if base_mode == 'random':
        rng.shuffle(active)
    for drone in active:
        choices = []
        for j in range(3):
            if drone == -1 and r.protected_recovery and j != 0:
                continue
            costfuel = 0 if drone == -1 else r.fuel_use[j]
            costcash = 0 if drone == -1 else r.deploy_cost
            if fuel < costfuel or budget < costcash:
                continue
            cap = r.capacity[j]*(.5 if drone == -1 else 1.)
            rivals = (obs['n']-1)*.65 if last is None else sum(row.count(j) for row in last['allocations'])*(obs['n']-1)/obs['n']
            previous_capacity = counts[j]*cap
            def share(c):
                return min(c, obs['n']*r.reserve[j]*c/max(.001, c+rivals*r.capacity[j]))
            marginal = (share(previous_capacity+cap)-share(previous_capacity))*hazard_mean[j]*prices[j]
            risk = (1-r.clear[j]-.5*r.disruption[j]) * (r.repair_cost + 30)
            if ('hazard', j) in knowledge:
                risk = r.repair_cost+30 if knowledge['hazard', j] == 0 else 0
            utility = marginal-costcash-costfuel*r.fuel_cost
            if base_mode == 'safe_hauler':
                utility -= 1.25*risk + j*6
            else:
                utility -= .35*risk
            if p.objective == 0 and j == 0 and p.extracted[0]*r.titan_rate < r.objective_cap:
                utility += 5
            if p.objective == 2 and j == 2 and p.extracted[2]*r.pioneer_rate < r.objective_cap:
                utility += 8
            if base_mode == 'random':
                utility = rng.uniform(0, 100)
            if base_mode == 'one_credit_raider':
                utility += 30 if counts[j] == 0 else -40
            choices.append((utility+rng.uniform(0,.5), j, costfuel, costcash))
        if not choices:
            break
        utility,j,cf,cc = max(choices)
        if utility <= 0 and base_mode != 'random':
            continue
        plan.allocation[drone] = j
        counts[j] += 1
        fuel -= cf
        budget -= cc
    # Bids reflect gross value, competition and the previous revealed auction.
    for j,count in enumerate(counts):
        if count == 0 or -1 in plan.allocation or hazard_mean[j] == 0:
            continue
        gross = min(count*r.capacity[j], obs['n']*r.reserve[j])*hazard_mean[j]*prices[j]
        old_bids = [row[j] for row in last['bids']] if last else []
        maxold = max(old_bids, default=0)
        fraction = {'heavy_extractor': .20, 'safe_hauler': .20, 'scanner_heavy': .24,
                    'random': .16, 'one_credit_raider': 0., 'bid_monopolist': .50}.get(base_mode, .20)
        maxpay = min(r.bid_max, int(gross*fraction), int(budget))
        if base_mode == 'one_credit_raider':
            bid = r.bid_min
        elif base_mode == 'random':
            bid = rng.randint(r.bid_min, maxpay) if maxpay >= r.bid_min and rng.random() < .6 else 0
        else:
            desired = max(r.bid_min, maxold+rng.randint(1, 6))
            bid = desired if desired <= maxpay else (rng.randint(r.bid_min, maxpay) if maxpay >= r.bid_min and rng.random() < .35 else 0)
        if 0 < bid <= budget:
            plan.bids[j] = bid
            budget -= bid
    own_yield = [min(counts[j]*r.capacity[j], obs['n']*r.reserve[j])*hazard_mean[j] for j in range(3)]
    forecast, stock_forecast = predict(p, obs, knowledge, r, own_yield)
    # Liquidate cargo for operating liquidity or negative expected moves.
    for j in range(3):
        reserve = 0.
        objective_extra = r.logistics_rate if p.objective == 3 else 0
        if not p.contracts[j] and r.contract_score[j]+objective_extra > r.contract_qty[j]*forecast[j]:
            plan.contracts[j] = True
            reserve = r.contract_qty[j]
        available = max(0., p.inventory[j]-reserve)
        if available and (base_mode != 'pure_trader' or forecast[j] < prices[j]*(1-r.fee)):
            plan.commodity_orders[j] = -cargo(min(available, r.commodity_trade[j]))
        if p.shares[j] and (stock_forecast[j] < stocks[j]*(1-.015) or (base_mode != 'pure_trader' and budget < 90)):
            plan.stock_orders[j] = -min(p.shares[j], r.stock_trade)
    # Buy the best forecast return first; sales cannot finance same-round buys.
    if base_mode != 'hoarder':
        keep = 0 if obs['round'] == 6 or base_mode in ('pure_trader', 'pump_trader') else (150 if base_mode == 'heavy_extractor' else 90)
        candidates = []
        for j in range(3):
            sr = stock_forecast[j]/stocks[j]-1-r.fee
            cr = forecast[j]/prices[j]-1-r.fee
            if base_mode == 'random':
                sr, cr = rng.uniform(-.10,.10), rng.uniform(-.10,.10)
            if base_mode == 'pump_trader':
                sr = 1. if j == max(range(3), key=lambda k:p.shares[k]) else -1.
                cr = -1.
            candidates.extend([(sr, True, j), (cr, False, j)])
        for expected, stock, j in sorted(candidates, reverse=True):
            if expected <= .003:
                continue
            orders = plan.stock_orders if stock else plan.commodity_orders
            holdings = p.shares if stock else p.inventory
            if orders[j] != 0:
                continue
            quote = stocks[j] if stock else prices[j]
            limit = r.stock_trade if stock else r.commodity_trade[j]
            room = (r.stock_position if stock else r.commodity_position[j])-holdings[j]
            q = min(limit, room, max(0, budget-keep)/(quote*(1+r.fee)))
            q = int(q) if stock else cargo(q)
            while q > 0 and money(q*quote*(1+r.fee)) > budget+1e-8:
                q = q-1 if stock else cargo(q-.001)
            if q > 0:
                orders[j] = q
                budget = money(budget-money(q*quote*(1+r.fee)))
    validate(p, plan, prices, stocks, r)
    return plan


def upgrades(p, round_no, rng, r):
    if round_no >= 6 or p.policy in ('pure_trader', 'hoarder', 'pump_trader'):
        return
    for d in p.drones:
        if d.disabled and p.credits >= r.repair_cost+40:
            repair(p, d.id, r)
    if p.policy == 'scanner_heavy' and not p.scanner and round_no <= 2 and p.credits >= r.scanner_cost+130:
        p.credits = money(p.credits-r.scanner_cost)
        p.scanner = True
    target = {'heavy_extractor': r.fleet_limit, 'safe_hauler': 3, 'scanner_heavy': 3,
              'scanner_no_scan': 3, 'random': 4, 'one_credit_raider': 3, 'bid_monopolist': 4}.get(p.policy, 2)
    if round_no <= 3 and len(p.drones) < target and p.credits >= r.drone_cost+180:
        if p.policy != 'random' or rng.random() < .5:
            buy_drone(p, r)
    # At the proposed odds, insurance costs more than expected repair savings.
    # A rational safe hauler keeps its repair reserve instead of buying randomly.


def play(seed, policies=POLICIES[:4], r=Rules(), trace=False):
    world = random.Random(seed)
    seat_rng = random.Random(seed ^ 0x931A)
    policies = list(policies)
    seat_rng.shuffle(policies)
    objectives = list(range(4))
    seat_rng.shuffle(objectives)
    players = [Player(policy, objectives[i], drones=[Drone(0,r.drone_cost),Drone(1,r.drone_cost)]) for i,policy in enumerate(policies)]
    policy_rng = [random.Random(seed*37+seat*100003) for seat in range(len(players))]
    prices, stocks, history = list(r.base), [100.]*3, []
    metrics = dict(recovery=0, mincredits=750., maxwealth=0., maxprice_ratio=1., scans=0, rounds=[])
    for round_no in range(1,7):
        hazards = []
        for j in range(3):
            roll = world.random()
            hazards.append(1. if roll < r.clear[j] else .5 if roll < r.clear[j]+r.disruption[j] else 0.)
        events = [world.choices([-r.event_size,0.,r.event_size], [.2,.6,.2])[0] for _ in range(3)]
        demand = [len(players)*r.demand[j]*world.choices([.8,1.,1.2],[.25,.5,.25])[0] for j in range(3)]
        obs = public_observation(round_no, len(players), prices, stocks, demand, history)
        plans = []
        for p,rng in zip(players, policy_rng):
            prepare(p, obs, rng, r)
            knowledge = {}
            for target in scan_targets(p, obs, rng, r):
                cost = r.upgraded_scan_cost if p.scanner else r.scan_cost
                if p.credits >= cost+40:
                    scan(p,target,hazards,events,knowledge,r)
                    metrics['scans'] += 1
            plans.append(make_plan(p, obs, knowledge, rng, r))
        prices,stocks,reveal = settle(players,plans,prices,stocks,demand,hazards,events,world,r)
        history.append(reveal)
        metrics['recovery'] += reveal['recovery']
        metrics['mincredits'] = min(metrics['mincredits'], *(p.credits for p in players))
        metrics['maxwealth'] = max(metrics['maxwealth'], *(networth(p,prices,stocks,r) for p in players))
        metrics['maxprice_ratio'] = max(metrics['maxprice_ratio'], *(prices[j]/r.base[j] for j in range(3)), *(x/100 for x in stocks))
        if trace:
            metrics['rounds'].append(dict(round=round_no, prices=prices[:], stocks=stocks[:], demand=demand,
                plans=[asdict(pl) for pl in plans], reveal=reveal,
                scores=[breakdown(p,prices,stocks,r) for p in players]))
        for p,rng in zip(players, policy_rng):
            upgrades(p, round_no, rng, r)
    scores = [networth(p,prices,stocks,r) for p in players]
    best = max(scores)
    winners = [i for i,s in enumerate(scores) if s == best]
    return dict(seed=seed, policies=policies, scores=scores,
        wins=[1/len(winners) if i in winners else 0. for i in range(len(players))],
        objectives=objectives[:len(players)], bonuses=[objective_bonus(p,stocks,r) for p in players],
        breakdowns=[breakdown(p,prices,stocks,r) for p in players],
        scan_spend=[p.scan_spend for p in players], bid_spend=[p.bid_spend for p in players],
        metrics=metrics)
