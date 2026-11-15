import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))

from update_data import DataError, SEASON
from verified_availability import AVAILABILITY_SOURCE, DISCIPLINE_SOURCE, merge_reports


NOW = datetime.fromisoformat('2026-11-14T11:00:00+01:00')


def player_report(**changes):
    return {
        'playerId': 'player-a', 'playerName': 'Mario Rossi', 'teamId': 'alfa', 'fixtureId': 'alfa-beta', 'round': 12,
        'kind': 'injury', 'status': 'out', 'reason': 'Indisponibile per la partita.', 'sourceName': 'Club Alfa',
        'sourceUrl': 'https://alfa.example/out', 'publishedAt': '2026-11-12', **changes,
    }


def payload(*reports):
    return json.dumps({'schemaVersion': 1, 'season': SEASON, 'reports': reports}).encode()


class VerifiedAvailabilityTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = {
            'fixtures': [{'id': 'alfa-beta', 'homeId': 'alfa', 'awayId': 'beta', 'round': 12,
                          'status': 'scheduled', 'date': '2026-11-22', 'kickoff': '2026-11-22T15:00:00+01:00'}],
            'players': [{'id': 'player-a', 'name': 'Mario Rossi', 'teamId': 'alfa'},
                        {'id': 'player-b', 'name': 'Giuseppe Bianchi', 'teamId': 'beta'}],
            'absences': [], 'sources': [], 'coverage': {'absences': 'missing'},
        }

    def test_exact_identity_match_keeps_checked_article_metadata(self):
        real = player_report()
        wrong_name = player_report(playerName='Giorgio Rossi', sourceUrl='https://alfa.example/other')
        wrong_round = player_report(round=13, sourceUrl='https://alfa.example/next')
        future = player_report(publishedAt='2026-11-15', sourceUrl='https://alfa.example/future')
        counts = merge_reports(self.snapshot, payload(real, wrong_name, wrong_round, future), NOW)
        self.assertEqual(counts, {'applied': 1, 'unmatched': 2, 'inactive': 1, 'conflicts': 0})
        self.assertEqual(self.snapshot['coverage']['absences'], 'partial')
        result = self.snapshot['absences'][0]
        self.assertEqual(result['playerId'], 'player-a')
        for key in ('kind', 'status', 'reason', 'sourceName', 'sourceUrl', 'publishedAt'):
            self.assertEqual(result[key], real[key])
        self.assertEqual(result['sourceId'], AVAILABILITY_SOURCE)

    def test_resolution_of_conflicts_and_a_confirmed_recovery(self):
        out = player_report()
        conflicting = player_report(status='doubtful', sourceUrl='https://sport.example/doubt')
        result = merge_reports(self.snapshot, payload(out, conflicting), NOW)
        self.assertEqual(result['conflicts'], 1)
        self.assertEqual(self.snapshot['absences'][0]['status'], 'reported')
        self.assertEqual(len(self.snapshot['absences'][0]['references']), 2)
        available = player_report(kind='fitness', status='available', sourceUrl='https://alfa.example/return', publishedAt='2026-11-13')
        merge_reports(self.snapshot, payload(out, conflicting, available), NOW)
        self.assertEqual(self.snapshot['absences'][0]['status'], 'available')

    def test_suspension_overrides_same_player_news_and_preserves_another_feed_row(self):
        api = {'playerId': 'player-b', 'fixtureId': 'alfa-beta', 'teamId': 'beta', 'status': 'doubtful', 'sourceId': 'api-football'}
        self.snapshot['absences'] = [api]
        suspension = player_report(kind='suspension', status='suspended', sourceName='Lega Serie A',
                                   sourceUrl='https://img.legaseriea.it/document.pdf', publishedAt='2026-11-10')
        report = player_report(kind='fitness', status='available', publishedAt='2026-11-14')
        merge_reports(self.snapshot, payload(suspension, report), NOW)
        first, second = self.snapshot['absences']
        self.assertEqual((first['status'], first['sourceId']), ('suspended', DISCIPLINE_SOURCE))
        self.assertEqual(second, api)

    def test_no_curated_status_after_kickoff_and_while_result_is_unknown(self):
        reports = payload(player_report())
        merge_reports(self.snapshot, reports, NOW)
        self.snapshot['fixtures'][0]['status'] = 'unknown'
        merge_reports(self.snapshot, reports, NOW)
        self.assertEqual(self.snapshot['absences'], [])
        self.assertEqual(self.snapshot['sources'], [])
        self.assertEqual(self.snapshot['coverage']['absences'], 'missing')
        self.snapshot['fixtures'][0]['status'] = 'scheduled'
        kickoff = datetime.fromisoformat(self.snapshot['fixtures'][0]['kickoff'])
        self.assertEqual(merge_reports(self.snapshot, reports, kickoff)['inactive'], 1)
        self.assertEqual(self.snapshot['absences'], [])

    def test_untrusted_sanction_or_duplicate_is_rejected_before_mutating_base(self):
        previous = deepcopy(self.snapshot)
        unofficial = player_report(kind='suspension', status='suspended', sourceUrl='https://legaseriea.it.example.com/decision')
        for reports in (payload(unofficial), payload(player_report(sourceUrl='http://alfa.example/out')),
                        payload(player_report(), player_report())):
            with self.assertRaises(DataError):
                merge_reports(self.snapshot, reports, NOW)
            self.assertEqual(self.snapshot, previous)


if __name__ == '__main__':
    unittest.main()
