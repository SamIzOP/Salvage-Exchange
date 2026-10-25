"""Economic invariants and regression cases, independent of policy success."""
import copy
import math
import random
import unittest
import json
from pathlib import Path
from dataclasses import replace

from economy import (Rules, Player, Drone, Plan, money, commodity_update, stock_update,
    bounded_price, validate, settle, scan, recovery_eligible, objective_bonus,
    breakdown, networth, repair, insure, buy_drone, buy_fuel, public_observation, play)


class EconomyTests(unittest.TestCase):
    def setUp(self):
        self.r = Rules()
        self.prices = [24.,42.,72.]
        self.stocks = [100.]*3
        self.players = [Player('test',i) for i in range(4)]

    def resolve(self, plans, hazards=None, players=None, rules=None):
        return settle(players or self.players,plans,self.prices,self.stocks,[12,6,3],
                      hazards or [1,1,1],[0,0,0],random.Random(7),rules or self.r)

    def test_neutral_commodity_price(self):
        result,_ = commodity_update(self.prices,[12,6,3],[0,0,0],[12,6,3],[0,0,0],self.r)
        self.assertEqual(result,self.prices)

    def test_known_price_formula(self):
        result,terms = commodity_update(self.prices,[6,12,3],[3,0,0],[12,6,3],[.08,0,0],self.r)
        self.assertEqual(result,[27.60,36.96,72.])
        self.assertAlmostEqual(sum(terms[0]),.15)

    def test_stock_profit_baselines(self):
        result,terms = stock_update(self.stocks,self.prices,[12,6,3],[0,0,0],4,self.r)
        self.assertEqual(result,self.stocks)
        self.assertEqual([t['baseline'] for t in terms],[39.,33.25,27.5])

    def test_more_supply_can_reduce_commodity_but_raise_stock(self):
        prices,_ = commodity_update(self.prices,[14,6,3],[0,0,0],[12,6,3],[0,0,0],self.r)
        stocks,_ = stock_update(self.stocks,prices,[14,6,3],[0,0,0],4,self.r)
        self.assertLess(prices[0],24)
        self.assertGreater(stocks[0],100)

    def test_price_caps_after_rounding(self):
        for cents in range(600,40001,113):
            old=cents/100
            for rate in [-100,-.25,-.13,0,.25,100]:
                price=bounded_price(old,rate,1,1000)
                self.assertGreaterEqual(price/old,.75-1e-10)
                self.assertLessEqual(price/old,1.25+1e-10)

    def test_supply_and_trade_signals_bounded(self):
        _,terms=commodity_update(self.prices,[1e9,0,3],[1e9,-1e9,0],[12,6,3],[0,0,0],self.r)
        self.assertEqual(terms[0][0],-.12)
        self.assertEqual(terms[0][1],.04)
        self.assertEqual(terms[1][1],-.04)

    def test_proportional_share_conserves_reserve(self):
        plans=[Plan(allocation={0:0,1:0}) for _ in range(4)]
        _,_,log=self.resolve(plans)
        self.assertEqual(log['extraction'][0],12)
        self.assertEqual([p.inventory[0] for p in self.players],[3]*4)

    def test_exclusive_winner_pays_and_losers_still_launch(self):
        plans=[Plan(allocation={0:0},bids=[b,0,0]) for b in [20,10,0,0]]
        self.resolve(plans)
        self.assertEqual([p.inventory[0] for p in self.players],[4,0,0,0])
        self.assertEqual([p.credits for p in self.players],[724,744,744,744])
        self.assertEqual([p.fuel for p in self.players],[7]*4)

    def test_tied_bids_have_one_winner(self):
        plans=[Plan(allocation={0:0},bids=[20,0,0]) for _ in range(4)]
        self.resolve(plans)
        self.assertEqual(sum(p.inventory[0]>0 for p in self.players),1)
        self.assertEqual(sum(p.bid_spend for p in self.players),20)

    def test_damage_and_insurance(self):
        insure(self.players[0],0,self.r)
        plans=[Plan(allocation={0:2,1:2}) for _ in range(4)]
        self.resolve(plans,[1,1,0])
        self.assertFalse(self.players[0].drones[0].disabled)
        self.assertTrue(self.players[1].drones[0].disabled)
        self.assertFalse(self.players[1].drones[1].disabled)
        self.assertEqual(self.players[0].inventory[2],0)

    def test_depreciation_including_idle_drones(self):
        for _ in range(6):
            self.resolve([Plan() for _ in range(4)])
        self.assertEqual(self.players[0].drones[0].value,83.59)
        self.assertEqual(networth(self.players[0],self.prices,self.stocks,self.r),917.18)

    def test_no_spending_future_sale_proceeds(self):
        p=self.players[0]
        p.credits=0
        p.inventory[0]=4
        with self.assertRaisesRegex(ValueError,'reserved credits'):
            validate(p,Plan(commodity_orders=[-4,1,0]),self.prices,self.stocks,self.r)

    def test_all_bids_reserved(self):
        p=self.players[0]
        p.credits=100
        with self.assertRaisesRegex(ValueError,'reserved credits'):
            validate(p,Plan(allocation={0:0,1:1},bids=[60,60,0]),self.prices,self.stocks,self.r)

    def test_cannot_sell_future_extraction(self):
        with self.assertRaisesRegex(ValueError,'short sale'):
            validate(self.players[0],Plan(allocation={0:0},commodity_orders=[-4,0,0]),self.prices,self.stocks,self.r)

    def test_invalid_plan_does_not_mutate_any_player(self):
        before=copy.deepcopy(self.players)
        with self.assertRaises(ValueError):
            self.resolve([Plan(allocation={0:0}),Plan(),Plan(),Plan(stock_orders=[-1,0,0])])
        self.assertEqual(self.players,before)

    def test_order_and_position_limits(self):
        p=self.players[0]
        for plan in [Plan(stock_orders=[3,0,0]),Plan(stock_orders=[.5,0,0]),
                     Plan(commodity_orders=[4.001,0,0]),Plan(commodity_orders=[float('nan'),0,0])]:
            with self.assertRaises(ValueError):
                validate(p,plan,self.prices,self.stocks,self.r)
        p.shares[0]=6
        with self.assertRaises(ValueError):
            validate(p,Plan(stock_orders=[1,0,0]),self.prices,self.stocks,self.r)
        p.inventory[0]=21
        validate(p,Plan(),self.prices,self.stocks,self.r)
        with self.assertRaises(ValueError):
            validate(p,Plan(commodity_orders=[1,0,0]),self.prices,self.stocks,self.r)

    def test_fee_round_trip_loses_money_at_fixed_quotes(self):
        p=self.players[0]
        self.resolve([Plan(stock_orders=[1,0,0]),Plan(),Plan(),Plan()])
        self.resolve([Plan(stock_orders=[-1,0,0]),Plan(),Plan(),Plan()])
        self.assertEqual(p.credits,746)

    def test_contract_once_and_no_double_counting(self):
        p=self.players[0]
        p.inventory[0]=12
        plans=[Plan(contracts=[True,False,False]),Plan(),Plan(),Plan()]
        self.resolve(plans)
        self.assertEqual(p.credits,750)
        self.assertEqual(p.inventory[0],6)
        self.assertEqual(breakdown(p,self.prices,self.stocks,self.r)['contracts'],165)
        self.resolve(plans)
        self.assertEqual(p.inventory[0],6)

    def test_objective_caps_and_losses_offset_investment_gains(self):
        for i,p in enumerate(self.players):
            p.extracted=[100,100,100]
            p.contracts=[True]*3
            p.investment_flow=10000
            self.assertLessEqual(objective_bonus(p,self.stocks,self.r),120)
        shark=self.players[1]
        shark.investment_flow=-101
        shark.shares=[1,0,0]
        self.assertEqual(objective_bonus(shark,self.stocks,self.r),0)

    def test_recovery_is_limited_and_does_not_reset_losses(self):
        p=self.players[0]
        p.credits=0
        p.fuel=0
        for d in p.drones:
            d.disabled=True
        self.assertTrue(recovery_eligible(p,self.prices,self.stocks,self.r))
        self.resolve([Plan(allocation={-1:0}),Plan(),Plan(),Plan()])
        self.assertEqual(p.inventory[0],2)
        self.assertEqual(p.credits,0)
        self.assertFalse(recovery_eligible(p,self.prices,self.stocks,self.r))
        with self.assertRaises(ValueError):
            validate(p,Plan(allocation={-1:0}),self.prices,self.stocks,self.r)

    def test_emergency_cannot_mix_with_normal_or_bid(self):
        p=self.players[0]
        p.credits=p.fuel=0
        for plan in [Plan(allocation={-1:0,0:0}),Plan(allocation={-1:0},bids=[1,0,0])]:
            with self.assertRaises(ValueError):
                validate(p,plan,self.prices,self.stocks,self.r)

    def test_protected_recovery_survives_exclusive_bid(self):
        p=self.players[0]
        p.credits=p.fuel=0
        r=replace(self.r,protected_recovery=True)
        plans=[Plan(allocation={-1:0}),Plan(allocation={0:0,1:0},bids=[20,0,0]),Plan(),Plan()]
        _,_,log=self.resolve(plans,rules=r)
        self.assertEqual(p.inventory[0],2)
        self.assertEqual(self.players[1].inventory[0],8)
        self.assertLessEqual(log['extraction'][0],12)

    def test_all_emergency_players_share_finite_protected_reserve(self):
        r=replace(self.r,protected_recovery=True)
        for p in self.players:
            p.credits=p.fuel=0
        _,_,log=self.resolve([Plan(allocation={-1:0}) for _ in range(4)],rules=r)
        self.assertEqual(log['extraction'][0],8)

    def test_protected_recovery_is_not_free_rift_speculation(self):
        p=self.players[0]
        p.credits=p.fuel=0
        with self.assertRaisesRegex(ValueError,'Belt-only'):
            validate(p,Plan(allocation={-1:2}),self.prices,self.stocks,replace(self.r,protected_recovery=True))

    def test_scan_budget_duplicates_and_limit(self):
        p=self.players[0]
        knowledge={}
        scan(p,('hazard',2),[1,.5,0],[0,.08,-.08],knowledge,self.r)
        self.assertEqual(knowledge,{('hazard',2):0})
        self.assertEqual(p.credits,730)
        with self.assertRaises(ValueError):
            scan(p,('hazard',2),[1,.5,0],[0,.08,-.08],knowledge,self.r)
        scan(p,('event',1),[1,.5,0],[0,.08,-.08],knowledge,self.r)
        with self.assertRaises(ValueError):
            scan(p,('hazard',0),[1,.5,0],[0,.08,-.08],knowledge,self.r)

    def test_observation_contains_no_current_secrets(self):
        obs=public_observation(1,4,self.prices,self.stocks,[12,6,3],[])
        self.assertEqual(set(obs),{'round','n','prices','stocks','demand','history'})

    def test_purchases_and_repair_cannot_repeat_for_free(self):
        p=self.players[0]
        with self.assertRaises(ValueError):
            repair(p,0,self.r)
        buy_fuel(p,8,self.r)
        with self.assertRaises(ValueError):
            buy_fuel(p,1,self.r)
        insure(p,0,self.r)
        with self.assertRaises(ValueError):
            insure(p,0,self.r)
        for _ in range(3):
            p.credits=1000
            buy_drone(p,self.r)
        with self.assertRaises(ValueError):
            buy_drone(p,self.r)

    def test_seed_reproduces_complete_match(self):
        self.assertEqual(play(420,trace=True),play(420,trace=True))

    def test_final_rules_recovery_rebuilds_without_gifted_credits(self):
        r=Rules.from_dict(json.loads(Path(__file__).with_name('rules-v0.2.json').read_text()))
        p=self.players[0]
        p.credits=p.fuel=0
        for d in p.drones:
            d.disabled=True
        self.resolve([Plan(allocation={-1:0}),Plan(allocation={0:0},bids=[5,0,0]),Plan(),Plan()],rules=r)
        self.assertEqual(p.inventory[0],1.5)
        self.assertEqual(p.credits,0)
        self.resolve([Plan(allocation={-1:0},commodity_orders=[-1.5,0,0]),Plan(),Plan(),Plan()],rules=r)
        self.assertEqual(p.credits,35.28)
        self.assertEqual(p.inventory[0],1.5)
        self.assertFalse(recovery_eligible(p,self.prices,self.stocks,r))
        self.resolve([Plan(commodity_orders=[-1.5,0,0]),Plan(),Plan(),Plan()],rules=r)
        repair(p,0,r)
        buy_fuel(p,1,r)
        validate(p,Plan(allocation={0:0}),self.prices,self.stocks,r)

    def test_final_rules_fuzz_market_bounds(self):
        r=Rules.from_dict(json.loads(Path(__file__).with_name('rules-v0.2.json').read_text()))
        rng=random.Random(8811)
        prices,stocks=list(r.base),[100.]*3
        for _ in range(10000):
            n=rng.choice([2,3,4])
            extraction=[rng.random()*n*r.reserve[j] for j in range(3)]
            demand=[n*r.demand[j]*rng.choice([.8,1,1.2]) for j in range(3)]
            nettrade=[rng.uniform(-n*r.commodity_trade[j],n*r.commodity_trade[j]) for j in range(3)]
            events=[rng.choice([-r.event_size,0,r.event_size]) for _ in range(3)]
            newprices,_=commodity_update(prices,extraction,nettrade,demand,events,r)
            newstocks,_=stock_update(stocks,newprices,extraction,[rng.randint(-2*n,2*n) for _ in range(3)],n,r)
            for j in range(3):
                self.assertTrue(r.base[j]/4 <= newprices[j] <= r.base[j]*4)
                self.assertTrue(.75-1e-8 <= newprices[j]/prices[j] <= 1.25+1e-8)
                self.assertTrue(25 <= newstocks[j] <= 400)
                self.assertTrue(.75-1e-8 <= newstocks[j]/stocks[j] <= 1.25+1e-8)
            prices,stocks=newprices,newstocks

    def test_final_alloy_glut_really_lowers_alloy_price(self):
        r=Rules.from_dict(json.loads(Path(__file__).with_name('rules-v0.2.json').read_text()))
        prices,_=commodity_update(list(r.base),[9,6,3],[0,0,0],[7.2,6,3],[0,0,0],r)
        self.assertEqual(prices[0],23.28)

    def test_own_price_pressure_cannot_fund_fee_round_trip(self):
        r=Rules.from_dict(json.loads(Path(__file__).with_name('rules-v0.2.json').read_text()))
        for n in (2,3,4):
            demand=[n*x*.8 for x in r.demand]
            for j in range(3):
                net=[0,0,0]
                net[j]=r.commodity_trade[j]
                updated,_=commodity_update(list(r.base),demand,net,demand,[0,0,0],r)
                cost=money(net[j]*r.base[j]*(1+r.fee))
                proceeds=money(net[j]*updated[j]*(1-r.fee))
                self.assertLessEqual(proceeds,cost)


if __name__ == '__main__':
    unittest.main(verbosity=2)
