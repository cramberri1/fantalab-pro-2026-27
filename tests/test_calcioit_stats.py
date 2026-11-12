import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))

from calcioit_stats import apply_calcioit_team_xg
from update_data import DataError, ROOT


class CalcioItTests(unittest.TestCase):
    def setUp(self):
        self.raw = (ROOT / 'data' / 'calcioit-team-xg.json').read_bytes()
        self.seed = json.loads(self.raw)
        self.snapshot = {
            'season': '2026/27', 'sources': [], 'coverage': {'expectedGoals': 'missing'},
            'teams': [{'id': team['id'], 'stats': {'matches': 5, 'xg': None, 'xga': None}}
                      for team in self.seed['teams']],
            'players': [{'id': 'sample', 'xg': None, 'xa': None}],
        }

    def test_seed_keeps_xg_sample_distinct_from_the_results(self):
        apply_calcioit_team_xg(self.snapshot, self.raw)
        first = self.snapshot['teams'][0]['stats']
        self.assertEqual(first['matches'], 5)
        self.assertEqual(first['xgMatches'], 11)
        self.assertEqual(first['xgSource'], 'calcioit-team-xg')
        self.assertEqual(first['xg'], 17.22)
        self.assertIsNone(first['xga'])
        self.assertIsNone(self.snapshot['players'][0]['xg'])
        self.assertEqual(self.snapshot['coverage']['expectedGoals'], 'missing')
        self.assertEqual(self.snapshot['coverage']['teamExpectedGoals'], 'available')
        self.assertEqual(self.snapshot['sources'][0]['fixturesWithXg'], 110)

    def test_fallback_preserves_xg_calculated_from_match_details(self):
        first = self.snapshot['teams'][0]['stats']
        first.update(xg=4.25, xga=3.75)
        apply_calcioit_team_xg(self.snapshot, self.raw)
        self.assertEqual(first, {'matches': 5, 'xg': 4.25, 'xga': 3.75})
        self.assertEqual(self.snapshot['sources'][0]['teamsWithXg'], 19)

    def test_inconsistent_sample_is_rejected_before_applying_any_rows(self):
        self.seed['teams'][-1]['xgMatches'] = 12
        with self.assertRaises(DataError):
            apply_calcioit_team_xg(self.snapshot, json.dumps(self.seed).encode())
        self.assertTrue(all(team['stats']['xg'] is None for team in self.snapshot['teams']))
