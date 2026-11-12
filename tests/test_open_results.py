import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from open_results import (
    FOOTBALLANALYTICS_ID, FOOTBALLANALYTICS_LICENSE, VERIFIED_CLUB_SOURCE_ID,
    add_footballanalytics, add_verified_results,
)
from update_data import DataError


NOW = datetime(2026, 11, 12, 22, tzinfo=timezone.utc)


def fixture(home, away, day, score=(None, None), kickoff=None):
    return {
        'homeId': home, 'awayId': away, 'date': day, 'kickoff': kickoff,
        'status': 'unknown' if score == (None, None) else 'played',
        'homeGoals': score[0], 'awayGoals': score[1], 'homeXg': None, 'awayXg': None,
    }


def result(home, away, stamp, score):
    return {
        'home_team': home, 'away_team': away, 'kickoff_utc': stamp,
        'home_score': score[0], 'away_score': score[1],
        'country': 'Italy', 'league_slug': 'serie-a',
        'lambda_home': 4.2, 'lambda_away': 0.4,
    }


def export(rows, license_url=FOOTBALLANALYTICS_LICENSE):
    return json.dumps({
        'name': 'serie-a', 'license': license_url,
        'rows': len(rows), 'data': rows, 'generated_at': '2026-11-12T19:30:00Z',
    }).encode()


def snapshot(*fixtures):
    teams = [{'id': short.casefold(), 'shortName': short} for short in ('Inter', 'Roma', 'Como', 'Parma')]
    return {'fixtures': list(fixtures), 'teams': teams, 'coverage': {}, 'sources': [{'id': 'openfootball'}]}


class FootballAnalyticsResultsTest(unittest.TestCase):
    def test_merge_fills_missing_score_and_kickoff_only(self):
        schedule = snapshot(fixture('inter', 'como', '2026-08-23'))
        raw = export([result('Inter', 'Como', '2026-08-22T22:30:00Z', (2, 0))])
        credit = add_footballanalytics(schedule, NOW, raw)
        match = schedule['fixtures'][0]
        self.assertEqual(match['kickoff'], '2026-08-23T00:30:00+02:00')
        self.assertEqual((match['status'], match['homeGoals'], match['awayGoals']), ('played', 2, 0))
        self.assertEqual(match['resultSourceId'], FOOTBALLANALYTICS_ID)
        self.assertEqual(match['kickoffSourceId'], FOOTBALLANALYTICS_ID)
        self.assertIsNone(match['homeXg'])
        self.assertNotIn('lambda_home', match)
        self.assertEqual(credit['addedResults'], 1)
        self.assertEqual(schedule['coverage']['results'], 'available')

    def test_comparison_preserves_disagreements_and_ignores_different_dates(self):
        schedule = snapshot(
            fixture('inter', 'como', '2026-09-20', (1, 0)),
            fixture('roma', 'parma', '2026-09-20', (2, 1), '2026-09-20T20:45:00+02:00'),
            fixture('parma', 'como', '2026-09-22'),
        )
        credit = add_footballanalytics(schedule, NOW, export([
            result('Inter', 'Como', '2026-09-20T19:00:00Z', (1, 1)),
            result('Roma', 'Parma', '2026-09-20T19:00:00Z', (2, 1)),
            result('Parma', 'Como', '2026-09-23T19:00:00Z', (0, 0)),
        ]))
        self.assertEqual((credit['matchedOtherSources'], credit['conflictingResults'], credit['unmatchedResults']), (1, 1, 1))
        self.assertEqual(schedule['fixtures'][0]['awayGoals'], 0)
        self.assertIsNone(schedule['fixtures'][0]['kickoff'])
        self.assertEqual(schedule['fixtures'][1]['kickoff'], '2026-09-20T20:45:00+02:00')
        self.assertEqual(schedule['fixtures'][2]['status'], 'unknown')
        self.assertEqual(schedule['coverage']['results'], 'partial')

    def test_bad_license_and_duplicate_feed_leave_state_unchanged(self):
        schedule = snapshot(fixture('inter', 'como', '2026-09-20'))
        match = result('Inter', 'Como', '2026-09-20T19:00:00Z', (0, 0))
        for bad in [export([match], 'https://example.org/unknown'), export([match, match])]:
            with self.assertRaises(DataError):
                add_footballanalytics(schedule, NOW, bad)
            self.assertEqual(schedule['fixtures'][0]['status'], 'unknown')
            self.assertEqual(schedule['sources'], [{'id': 'openfootball'}])

    def test_club_reports_fill_only_matching_historical_gaps(self):
        missing = dict(fixture('napoli', 'frosinone', '2026-10-10'), id='napoli-frosinone')
        conflict = dict(fixture('lazio', 'monza', '2026-10-11', (0, 0)), id='lazio-monza')
        wrong_date = dict(fixture('atalanta', 'venezia', '2026-10-13'), id='atalanta-venezia')
        schedule = snapshot(missing, conflict, wrong_date)
        credit = add_verified_results(schedule, NOW)
        self.assertEqual((missing['homeGoals'], missing['awayGoals']), (3, 0))
        self.assertEqual(missing['resultSourceId'], VERIFIED_CLUB_SOURCE_ID)
        self.assertEqual(missing['resultReferenceUrl'], credit['references'][0]['url'])
        self.assertTrue(credit['references'][0]['confirmationUrl'].startswith('https://'))
        self.assertEqual(conflict['homeGoals'], 0)
        self.assertEqual(wrong_date['status'], 'unknown')
        self.assertEqual((credit['addedResults'], credit['conflictingResults']), (1, 1))
