import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))

from update_data import DataError
from yuvron_probe import HOST, MAX_REQUESTS, YuvronProbe, coverage_report


def match(season, match_id):
    return {'id': match_id, 'season': season, 'status': 'finished', 'competition': 'serie-a'}


def mocked_fetch(url, *, headers, limit):
    parts = urlsplit(url)
    assert parts.netloc == HOST and parts.scheme == 'https'
    assert headers == {'X-RapidAPI-Key': 'example-secret', 'X-RapidAPI-Host': HOST}
    assert limit == 2_000_000
    if parts.path == '/matches':
        params = parse_qs(parts.query)
        season, = params['season']
        page = int(params['page'][0])
        assert params['status'] == ['finished'] and params['limit'] == ['10']
        base = 100 if season == '2025-26' else 200
        ids = range(base + 1, base + 11) if page == 1 else [base + 11]
        payload = {
            'data': [match(season, match_id) for match_id in ids],
            'meta': {'season': season, 'page': page, 'limit': 10, 'total': 11},
        }
    else:
        match_id = int(parts.path.removeprefix('/matches/'))
        season = '2025-26' if match_id < 200 else '2026-27'
        starter = {'player': {'name': 'Private player name'}, 'minutes': 90, 'goals': 0, 'assists': 0,
                   'stats': {'expectedGoals': 0, 'expectedAssists': 0}}
        sub = {'minutes': 4, 'goals': 0, 'assists': 0,
               'stats': {'expectedGoals': None, 'expectedAssists': 0}}
        lineup = {'starting': [starter] * 11, 'bench': [sub, {'minutes': 0}, {'minutes': None}]}
        payload = {'data': {**match(season, match_id), 'lineups': {'home': lineup, 'away': lineup}}}
    return json.dumps(payload).encode('utf-8'), {}


class YuvronProbeTests(unittest.TestCase):
    @patch('yuvron_probe.fetch', side_effect=mocked_fetch)
    def test_reports_sample_coverage_without_printing_provider_records(self, fetch):
        client = YuvronProbe('example-secret')
        report = coverage_report(client)
        for season in ('2025/26', '2026/27'):
            self.assertIn(f'| {season} | 11 | 3 | 3 | 72 | 72 | 72 | 72 | 66 | 72 |', report)
        self.assertEqual(fetch.call_count, MAX_REQUESTS)
        self.assertNotIn('Private player name', report)
        self.assertNotIn('example-secret', report)

    @patch('yuvron_probe.fetch')
    def test_request_budget_is_enforced_before_network_access(self, fetch):
        client = YuvronProbe('example-secret')
        client.requests = MAX_REQUESTS
        with self.assertRaisesRegex(DataError, 'Limite di richieste'):
            client.get('/matches')
        fetch.assert_not_called()

    @patch('yuvron_probe.fetch', return_value=(b'{"error": "example-secret"}', {}))
    def test_provider_errors_are_replaced_by_safe_messages(self, _fetch):
        client = YuvronProbe('example-secret')
        with self.assertRaises(DataError) as failure:
            client.get('/matches')
        self.assertNotIn('example-secret', str(failure.exception))


if __name__ == '__main__':
    unittest.main()
