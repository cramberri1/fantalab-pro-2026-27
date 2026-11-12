import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))

from licensed import FootballAPI, add_player_stats, enrich_api_football, enrich_metrics, map_fixtures
from update_data import DataError, SNAPSHOT, calculate_team_stats, decode, validate


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = decode(SNAPSHOT.read_bytes())

    def test_published_snapshot_validates_and_preserves_unknowns(self):
        validate(self.snapshot)
        self.assertEqual(len(self.snapshot['fixtures']), 380)
        self.assertEqual(len(self.snapshot['teams']), 20)
        self.assertTrue(self.snapshot['players'])
        unknown = [f for f in self.snapshot['fixtures'] if f['status'] == 'unknown']
        self.assertTrue(all(f['homeGoals'] is None and f['awayGoals'] is None for f in unknown))
        if self.snapshot['coverage']['expectedGoals'] == 'missing':
            self.assertTrue(all(p['xg'] is None for p in self.snapshot['players']))
        if self.snapshot['coverage']['expectedAssists'] == 'missing':
            self.assertTrue(all(p['xa'] is None for p in self.snapshot['players']))

    def test_team_totals_only_count_final_results(self):
        self.snapshot['fixtures'] = self.snapshot['fixtures'][:1]
        fixture = self.snapshot['fixtures'][0]
        self.snapshot['coverage']['results'] = 'partial'
        calculate_team_stats(self.snapshot)
        teams = {t['id']: t['stats'] for t in self.snapshot['teams']}
        self.assertEqual(teams[fixture['homeId']]['matches'], 1)
        self.assertEqual(teams[fixture['awayId']]['goalsFor'], fixture['awayGoals'])
        self.assertIsNone(teams[fixture['homeId']]['xg'])
        self.assertEqual(sum(t['matches'] or 0 for t in teams.values()), 2)

    def test_api_does_not_override_a_conflicting_public_result(self):
        fixture = self.snapshot['fixtures'][0]
        row = {
            'fixture': {'id': 10, 'status': {'short': 'FT'}},
            'teams': {'home': {'id': 1}, 'away': {'id': 2}},
            'goals': {'home': fixture['homeGoals'] + 1, 'away': fixture['awayGoals']},
        }
        with self.assertRaises(DataError):
            map_fixtures(self.snapshot, {1: fixture['homeId'], 2: fixture['awayId']}, [row])

    def test_api_links_player_by_name_and_team_and_preserves_unknown_totals(self):
        player = {'id': 'tb-99', 'name': 'M. Rossi', 'teamId': 'roma'}
        wrong_team = {'id': 'tb-55', 'name': 'M. Rossi', 'teamId': 'lazio'}
        row = {
            'player': {'id': 99, 'name': 'M. Rossi'},
            'statistics': [{
                'team': {'id': 1}, 'league': {'id': 135, 'season': 2026},
                'games': {'minutes': 90, 'lineups': 1, 'appearences': 1},
                'goals': {'total': 0, 'assists': None},
            }],
        }
        data = {'players': [wrong_team, player], 'coverage': {}}
        matched = add_player_stats(data, {1: 'roma'}, [row])
        self.assertIs(matched[99], player)
        self.assertEqual(player['goals'], 0)
        self.assertEqual(player['minutes'], 90)
        self.assertIsNone(player['assists'])
        self.assertNotIn('minutes', wrong_team)

    def test_authorized_overlay_joins_exact_player_and_match_ids(self):
        player = self.snapshot['players'][0]
        fixture = self.snapshot['fixtures'][0]
        export = {
            'season': '2026/27',
            'source': {
                'name': 'Unit-test provider', 'url': 'https://example.org/provider',
                'license': 'Test license', 'licenseUrl': 'https://example.org/license',
                'updatedAt': '2026-11-11T10:00:00Z', 'throughDate': '2026-11-10',
            },
            'players': [{'id': player['id'], 'xg': 0, 'xa': 0.5,
                         'history': [{'fixtureId': fixture['id'], 'minutes': 61}]}],
            'fixtures': [{'id': fixture['id'], 'homeXg': 1.2}],
        }
        with patch.dict(os.environ, {'METRICS_PUBLISH_ALLOWED': 'true'}), patch('licensed.metrics_input', return_value=export):
            enrich_metrics(self.snapshot)
        validate(self.snapshot)
        self.assertEqual(player['xg'], 0)
        self.assertIsNone(player['minutes'])
        self.assertEqual(player['history'][0]['round'], fixture['round'])
        self.assertIsNone(fixture['awayXg'])
        self.assertEqual(self.snapshot['coverage']['expectedAssists'], 'partial')


class GateTests(unittest.TestCase):
    def test_rights_gates_fail_before_network(self):
        with patch.dict(os.environ, {}, clear=True), patch('licensed.fetch') as network:
            with self.assertRaisesRegex(DataError, 'API_FOOTBALL_PUBLISH_ALLOWED'):
                enrich_api_football({}, None)
            with self.assertRaisesRegex(DataError, 'METRICS_PUBLISH_ALLOWED'):
                enrich_metrics({})
            network.assert_not_called()

    def test_quota_header_stops_further_calls(self):
        payload = json.dumps({'response': [], 'errors': [], 'paging': {'total': 1}}).encode()
        with patch('licensed.fetch', return_value=(payload, {'x-ratelimit-requests-remaining': '0'})) as network:
            api = FootballAPI('test-secret', 25)
            self.assertEqual(api.all('players'), [])
            with self.assertRaises(DataError):
                api.all('players')
            self.assertEqual(network.call_count, 1)


if __name__ == '__main__':
    unittest.main()
