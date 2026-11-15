from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from open_results import FOOTBALLANALYTICS_LICENSE, add_footballanalytics
from verified_kickoffs import apply_verified_kickoffs


def juventus_venezia(**fields):
    return {'id': 'juventus-venezia', 'round': 12, 'homeId': 'juventus', 'awayId': 'venezia',
            'date': '2026-11-23', 'kickoff': '2026-11-23T20:45:00+01:00',
            'status': 'scheduled', 'homeGoals': None, 'awayGoals': None, **fields}


def schedule(*fixtures, updated_at='2026-11-14T12:00:00+00:00'):
    teams = [{'id': key, 'shortName': name} for key, name in [('juventus', 'Juventus'), ('venezia', 'Venezia')]]
    return {'season': '2026/27', 'updatedAt': updated_at, 'fixtures': list(fixtures), 'teams': teams,
            'sources': [{'id': 'openfootball'}], 'coverage': {'results': 'missing'}}


class VerifiedKickoffsTest(unittest.TestCase):
    def test_targets_the_verified_fixture_and_is_idempotent(self):
        match = juventus_venezia()
        data = schedule(match)
        self.assertEqual(apply_verified_kickoffs(data), 1)
        self.assertEqual(match['date'], '2026-11-22')
        self.assertEqual(match['kickoff'], '2026-11-22T12:30:00+01:00')
        self.assertEqual(match['kickoffSourceId'], data['sources'][-1]['id'])
        self.assertEqual(data['sources'][-1]['correctedFixtures'], 1)
        before = deepcopy(data)
        self.assertEqual(apply_verified_kickoffs(data), 0)
        self.assertEqual(data, before)

    def test_does_not_overwrite_scores_or_new_calendar_values(self):
        for fields in (
            {'status': 'played', 'homeGoals': 2, 'awayGoals': 0},
            {'round': 13}, {'homeId': 'inter'},
            {'date': '2026-11-25', 'kickoff': None}, {'kickoff': '2026-11-23T12:00:00+01:00'},
        ):
            with self.subTest(fields=fields):
                data = schedule(juventus_venezia(**fields))
                before = deepcopy(data)
                self.assertEqual(apply_verified_kickoffs(data), 0)
                self.assertEqual(data, before)

    def test_corrected_day_accepts_the_final_from_the_daily_update(self):
        now = datetime(2026, 11, 22, 15, tzinfo=timezone.utc)
        match = juventus_venezia()
        data = schedule(match, updated_at=now.isoformat())
        self.assertEqual(apply_verified_kickoffs(data), 1)
        self.assertEqual(match['status'], 'unknown')
        result = {'league_slug': 'serie-a', 'country': 'Italy', 'home_team': 'Juventus',
                  'away_team': 'Venezia', 'kickoff_utc': '2026-11-22T11:30:00Z',
                  'home_score': 2, 'away_score': 0}
        payload = {'name': 'serie-a', 'license': FOOTBALLANALYTICS_LICENSE, 'rows': 1,
                   'generated_at': now.isoformat(), 'data': [result]}
        source = add_footballanalytics(data, now, json.dumps(payload).encode())
        self.assertEqual(source['addedResults'], 1)
        self.assertEqual((match['status'], match['homeGoals'], match['awayGoals']), ('played', 2, 0))
        self.assertEqual(match['kickoffSourceId'], 'verified-league-kickoffs')


if __name__ == '__main__':
    unittest.main()
