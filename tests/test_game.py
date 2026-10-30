import copy
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from server.game import GameService, GameError


class GameTests(unittest.TestCase):
    def setUp(self):
        Path('data/tests').mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir='data/tests')
        self.addCleanup(self.tmp.cleanup)
        self.path = str(Path(self.tmp.name) / 'rooms.db')
        self.service = GameService(self.path)
        self.a, self.b = 'a' * 64, 'b' * 64
        self.view = self.service.create('Orion', self.a)
        self.code = self.view['code']
        self.service.join(self.code, 'Nova', self.b)
        self.count = 0

    def command(self, key, kind, **args):
        v = self.service.view(self.code, key)
        self.count += 1
        return self.service.command(self.code, key, dict(kind=kind, request_id=str(self.count),
            round=v['round'], phase=v['phase'], **args))

    def planning(self):
        self.command(self.a, 'start')
        self.command(self.a, 'ready')
        self.command(self.b, 'ready')

    def test_restart_and_identity(self):
        restarted = GameService(self.path)
        self.assertEqual(restarted.view(self.code, self.a)['you']['name'], 'Orion')
        with self.assertRaises(GameError):
            restarted.view(self.code, 'c' * 64)
        self.assertEqual(len(restarted.join(self.code, 'Again', self.b)['players']), 2)

    def test_lock_privacy_atomic_rejection_and_settlement(self):
        self.planning()
        initial = self.service.view(self.code, self.a)
        with self.assertRaises(GameError):
            self.command(self.a, 'lock', plan={'stock_orders': [6, 6, 6]})
        self.assertEqual(self.service.view(self.code, self.a), initial)
        self.command(self.a, 'lock', plan={'allocation': {'0': 0}, 'bids': [17, 0, 0]})
        other = self.service.view(self.code, self.b)
        self.assertNotIn('plan', other['players'][0])
        self.assertNotIn('objective', other['players'][0])
        self.assertNotIn('hazards', other)
        self.assertNotIn('credentials', str(other))
        result = self.command(self.b, 'lock', plan={})
        self.assertEqual(result['phase'], 'upgrade')
        self.assertEqual(len(result['history']), 1)
        self.assertEqual(result['history'][0]['bids'][0], [17, 0, 0])
        self.assertEqual(result['history'][0]['scores'][0]['credits'], 727)
        self.assertEqual(result['you']['breakdown']['fleet'], 457.6)

    def test_receipt_prevents_duplicate_purchase_and_stale_command(self):
        self.command(self.a, 'start')
        cmd = dict(kind='purchase', item='fuel', quantity=2, request_id='same', round=1, phase='briefing')
        first = self.service.command(self.code, self.a, cmd)
        again = self.service.command(self.code, self.a, cmd)
        self.assertEqual(first, again)
        self.assertEqual(again['you']['fuel'], 10)
        self.assertEqual(again['you']['credits'], 734)
        with self.assertRaises(GameError):
            self.service.command(self.code, self.a, {**cmd, 'quantity': 3})

    def test_scan_is_private_and_preview_uses_only_own_knowledge(self):
        self.command(self.a, 'start')
        scan = self.command(self.a, 'scan', target='hazard', sector=0)
        self.assertEqual(scan['you']['credits'], 730)
        self.assertEqual(len(scan['you']['scans']), 1)
        self.assertEqual(self.service.view(self.code, self.b)['you']['scans'], [])
        before = self.service.preview(self.code, self.b, {}, 1)
        self.assertEqual(before['personal'], [0, 0, 0])
        self.assertEqual(before['rival_supply'], [2.25, 1.5, .75])
        self.assertEqual(before['contract_cost'], [144, 126, 144])
        self.command(self.a, 'ready')
        self.command(self.b, 'ready')
        self.command(self.a, 'lock', plan={'allocation': {'0': 2}, 'bids': [0, 0, 100]})
        self.assertEqual(self.service.preview(self.code, self.b, {}, 1), before)

    def test_last_lock_can_deploy_and_upgrade_after_resolution(self):
        self.planning()
        self.command(self.a, 'lock', plan={})
        result = self.command(self.b, 'lock', plan={'allocation': {'0': 0}})
        self.assertEqual(result['phase'], 'upgrade')
        result = self.command(self.a, 'purchase', item='scanner')
        self.assertTrue(result['you']['scanner'])
        self.assertEqual(result['you']['credits'], 680)

    def test_upgrade_purchases_open_after_both_empty_plans(self):
        self.planning()
        self.command(self.a, 'lock', plan={})
        self.command(self.b, 'lock', plan={})
        result = self.command(self.a, 'purchase', item='drone')
        self.assertEqual(len(result['you']['drones']), 3)
        self.assertEqual(result['you']['drones'][-1]['value'], 260)

    def test_simultaneous_locks_and_retries_resolve_once(self):
        self.planning()
        cmd = dict(kind='lock', request_id='concurrent', round=1, phase='planning', plan={'allocation': {'0': 0}})
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda key: self.service.command(self.code, key, cmd), [self.a, self.b, self.a, self.b]))
        final = self.service.view(self.code, self.a)
        self.assertEqual(final['phase'], 'upgrade')
        self.assertEqual(len(final['history']), 1)
        self.assertEqual(final['you']['credits'], 744)
        self.assertEqual(final['you']['breakdown']['fleet'], 457.6)

    def test_recovery_is_protected_and_no_extra_reserve_created(self):
        self.planning()
        with self.service.store.transaction() as db:
            room = self.service.store.load(db, self.code)
            room['members'][0]['player'].update(credits=0, fuel=0, drones=[])
            room['hazards'] = [1., 1., 1.]
            room['events'] = [0., 0., 0.]
            self.service.store.save(db, room)
        self.command(self.a, 'lock', plan={'allocation': {'-1': 0}})
        result = self.command(self.b, 'lock', plan={'allocation': {'0': 0, '1': 0}, 'bids': [120, 0, 0]})
        self.assertEqual(result['history'][0]['gains'][0], [1.5, 0, 0])
        self.assertEqual(result['history'][0]['extraction'], [4.5, 0, 0])
        self.assertEqual(self.service.view(self.code, self.a)['you']['credits'], 0)

    def test_final_round_scores_and_no_upgrade_after_finish(self):
        self.planning()
        # Focused phase-boundary fixture, not a complete browser match.
        with self.service.store.transaction() as db:
            room = self.service.store.load(db, self.code)
            room['round'] = 6
            self.service.store.save(db, room)
        self.command(self.a, 'lock', plan={})
        result = self.command(self.b, 'lock', plan={})
        self.assertEqual(result['phase'], 'finished')
        self.assertEqual(result['players'][0]['networth'], 1207.6)
        self.assertIn('objective', result['players'][0])
        self.assertIn('breakdown', result['players'][0])
        with self.assertRaises(GameError):
            self.command(self.a, 'purchase', item='drone')

    def test_four_seats_and_no_late_join(self):
        self.service.join(self.code, 'Third', 'c' * 64)
        self.service.join(self.code, 'Fourth', 'd' * 64)
        with self.assertRaises(GameError):
            self.service.join(self.code, 'Fifth', 'e' * 64)
        self.command(self.a, 'start')
        with self.assertRaises(GameError):
            self.service.join(self.code, 'Late', 'f' * 64)

    def test_extreme_orders_reject_cleanly_without_mutation(self):
        self.planning()
        initial = self.service.view(self.code, self.a)
        with self.assertRaises(GameError):
            self.command(self.a, 'lock', plan={'commodity_orders': [1e308, 0, 0]})
        with self.assertRaises(GameError):
            self.service.preview(self.code, self.a, {'commodity_orders': [1e308, 0, 0]}, 1)
        self.assertEqual(self.service.view(self.code, self.a), initial)

    def test_own_settlement_report_reconciles_and_stays_private(self):
        self.planning()
        with self.service.store.transaction() as db:
            room = self.service.store.load(db, self.code)
            room['hazards'] = [1., 0., 1.]
            room['events'] = [0., 0., 0.]
            room['members'][0]['player']['inventory'] = [3., 0., 0.]
            room['members'][0]['player']['drones'][1]['insured'] = True
            self.service.store.save(db, room)
        self.command(self.a, 'lock', plan={'allocation': {'0': 0, '1': 1}, 'bids': [0, 15, 0],
                                           'commodity_orders': [-2, 1, 0], 'stock_orders': [2, 0, 0]})
        result = self.command(self.b, 'lock', plan={'allocation': {'0': 1}})
        log = result['history'][0]
        self.assertNotIn('reports', result['players'][0])
        self.assertNotIn("'trades'", str(result['players']))
        mine = self.service.view(self.code, self.a)['you']['reports']
        self.assertEqual(len(mine), 1)
        report = mine[0]
        self.assertEqual(report['round'], 1)
        self.assertEqual(report['deployment'], 12)
        self.assertEqual(report['fuel'], 3)
        self.assertEqual(report['bid_paid'], 15)
        self.assertEqual(len(report['trades']), 3)
        cents = lambda x: round(x * 100)
        flow = report['trade_cash'] - report['deployment'] - report['bid_paid']
        self.assertEqual(cents(report['after']['credits'] - report['before']['credits']), cents(flow))
        public = [k for k in report['before'] if k != 'objective']
        self.assertEqual(sum(cents(report['after'][k]) - cents(report['before'][k]) for k in public), cents(log['deltas'][0]))
        fleet = report['after']['fleet'] - report['before']['fleet']
        self.assertLessEqual(abs(cents(fleet) - cents(-report['depreciation'] + report['disabling'])), 1)
        # Seat 0 won the Cruiser bid, the Cruiser was severe, and its insured drone was repaired.
        self.assertEqual(report['hits'], [dict(drone=1, sector=1, repaired=True)])
        self.assertEqual(report['disabling'], 0)
        rival = self.service.view(self.code, self.b)['you']['reports'][0]
        self.assertEqual((rival['bid_paid'], rival['trades'], rival['hits']), (0, [], []))

    def test_report_splits_uninsured_disablement_from_depreciation(self):
        self.planning()
        with self.service.store.transaction() as db:
            room = self.service.store.load(db, self.code)
            room['hazards'] = [0., 1., 1.]
            self.service.store.save(db, room)
        self.command(self.a, 'lock', plan={'allocation': {'0': 0}})
        self.command(self.b, 'lock', plan={})
        report = self.service.view(self.code, self.a)['you']['reports'][0]
        self.assertEqual(report['hits'], [dict(drone=0, sector=0, repaired=False)])
        self.assertEqual(report['depreciation'], 62.4)
        self.assertEqual(report['disabling'], -171.6)
        self.assertEqual(round(report['after']['fleet'] - report['before']['fleet'], 2), -234)

    def test_market_audit_records_rounding_and_clipping(self):
        from server.game import price_audit
        self.assertEqual(price_audit(6.02, .3, 1., 100.), dict(raw_return=.3, capped_return=.25,
            rounded_quote=7.53, lower=4.52, upper=7.52, price=7.52, return_clipped=True, quote_clipped=True))


if __name__ == '__main__':
    unittest.main()
