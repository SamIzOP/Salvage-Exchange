"""Offline economic consistency only; these are not browser multiplayer tests."""
import json
import unittest
from pathlib import Path
from simulation import economy as e
from server.game import RULES, plan


class FrozenReplayTests(unittest.TestCase):
    def test_frozen_two_three_four_player_replays(self):
        for n in [2, 3, 4]:
            with self.subTest(players=n):
                saved = json.loads(Path(f'simulation/results/replay-{n}-player.json').read_text())
                actual = e.play(saved['seed'], e.POLICIES[:n], RULES, trace=True)
                self.assertEqual(json.loads(json.dumps(actual)), saved)

    def test_every_saved_plan_parses_and_every_market_transition_matches(self):
        for n in [2, 3, 4]:
            saved = json.loads(Path(f'simulation/results/replay-{n}-player.json').read_text())
            opening, stocks = list(RULES.base), [100.] * 3
            for row in saved['metrics']['rounds']:
                with self.subTest(players=n, round=row['round']):
                    for raw in row['plans']:
                        parsed = plan(raw)
                        self.assertEqual(parsed.bids, raw['bids'])
                    log = row['reveal']
                    prices, terms = e.commodity_update(opening, log['extraction'], log['netcargo'], row['demand'], log['events'], RULES)
                    shares, stock_terms = e.stock_update(stocks, prices, log['extraction'], log['netstock'], n, RULES)
                    self.assertEqual(prices, row['prices'])
                    self.assertEqual(shares, row['stocks'])
                    self.assertEqual(terms, log['commodity_terms'])
                    self.assertEqual(stock_terms, log['stock_terms'])
                    opening, stocks = prices, shares


if __name__ == '__main__':
    unittest.main()
