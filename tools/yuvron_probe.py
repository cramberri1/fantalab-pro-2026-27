"""Measure Yuvron Serie A coverage without storing individual match data."""

import math
import os
from pathlib import Path
import sys
from urllib.parse import urlencode

from update_data import DataError, decode, fetch


HOST = 'serie-a6.p.rapidapi.com'
SEASONS = ('2025-26', '2026-27')
PAGE_SIZE = 10
MAX_REQUESTS = 10
FIELDS = ('minutes', 'goals', 'assists', 'expectedGoals', 'expectedAssists')


class YuvronProbe:
    def __init__(self, key):
        self.headers = {'X-RapidAPI-Key': key, 'X-RapidAPI-Host': HOST}
        self.requests = 0

    def get(self, path, query=None):
        if self.requests >= MAX_REQUESTS:
            raise DataError('Limite di richieste per il test Yuvron raggiunto.')
        self.requests += 1
        url = f'https://{HOST}{path}'
        if query:
            url += '?' + urlencode(query)
        raw, _ = fetch(url, headers=self.headers, limit=2_000_000)
        payload = decode(raw)
        if not isinstance(payload, dict) or 'error' in payload or 'data' not in payload:
            raise DataError('Yuvron ha restituito una risposta inattesa.')
        return payload


def positive_int(value):
    return type(value) is int and value > 0


def present(value):
    if type(value) is int:
        return value >= 0
    return type(value) is float and value >= 0 and math.isfinite(value)


def match_record(row, season):
    return (
        isinstance(row, dict)
        and positive_int(row.get('id'))
        and row.get('season') == season
        and row.get('competition') == 'serie-a'
        and row.get('status') == 'finished'
    )


def match_page(client, season, page):
    result = client.get('/matches', {'season': season, 'status': 'finished', 'page': page, 'limit': PAGE_SIZE})
    rows = result['data']
    meta = result.get('meta')
    if (
        not isinstance(rows, list)
        or not isinstance(meta, dict)
        or meta.get('season') != season
        or meta.get('page') != page
        or meta.get('limit') != PAGE_SIZE
        or not positive_int(meta.get('total'))
        or not 1 <= len(rows) <= PAGE_SIZE
        or not all(match_record(row, season) for row in rows)
    ):
        raise DataError('Elenco partite Yuvron inatteso o senza risultati per la stagione richiesta.')
    ids = [row['id'] for row in rows]
    if len(set(ids)) != len(ids):
        raise DataError('L’elenco partite Yuvron contiene duplicati.')
    return ids, meta['total']


def sample_ids(client, season):
    first, total = match_page(client, season, 1)
    if total <= PAGE_SIZE:
        if total != len(first):
            raise DataError('Il totale di Yuvron non corrisponde al numero di partite restituite.')
        return list(dict.fromkeys([first[0], first[len(first) // 2], first[-1]])), total
    last_page = (total + PAGE_SIZE - 1) // PAGE_SIZE
    last, final_total = match_page(client, season, last_page)
    expected_last_count = total - (last_page - 1) * PAGE_SIZE
    if total != final_total or len(first) != PAGE_SIZE or len(last) != expected_last_count:
        raise DataError('La paginazione Yuvron è cambiata durante il test.')
    chosen = [first[0], first[-1], last[-1]]
    if len(set(chosen)) != len(chosen):
        raise DataError('La paginazione Yuvron ha restituito partite duplicate.')
    return chosen, total


def inspect_match(client, season, match_id, coverage):
    match = client.get(f'/matches/{match_id}')['data']
    if not match_record(match, season) or match['id'] != match_id:
        raise DataError('Il tabellino Yuvron non corrisponde alla partita richiesta.')
    lineups = match.get('lineups')
    if not isinstance(lineups, dict):
        return False
    complete_starting = True
    for side in ('home', 'away'):
        lineup = lineups.get(side)
        if not isinstance(lineup, dict):
            complete_starting = False
            continue
        for group in ('starting', 'bench'):
            entries = lineup.get(group)
            if group == 'starting' and (not isinstance(entries, list) or len(entries) != 11):
                complete_starting = False
            if not isinstance(entries, list):
                continue
            for row in entries:
                if not isinstance(row, dict):
                    raise DataError('Il tabellino Yuvron contiene una riga giocatore inattesa.')
                minutes = row.get('minutes')
                # Count all reported starters and only substitutes known to have played.
                if group == 'bench' and (not present(minutes) or minutes == 0):
                    continue
                stats = row.get('stats')
                stats = stats if isinstance(stats, dict) else {}
                coverage['rows'] += 1
                for field in FIELDS:
                    value = stats.get(field) if field.startswith('expected') else row.get(field)
                    if present(value):
                        coverage[field] += 1
    return complete_starting


def coverage_report(client):
    lines = [
        '# Verifica copertura Yuvron Serie A',
        '',
        '| Stagione | Risultati dichiarati | Tabellini verificati | Con 22 titolari | Righe giocatore | Minuti | Gol | Assist | xG | xA |',
        '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ]
    for season in SEASONS:
        ids, total = sample_ids(client, season)
        coverage = dict.fromkeys(('rows', *FIELDS), 0)
        complete = sum(inspect_match(client, season, match_id, coverage) for match_id in ids)
        label = season[:4] + '/' + season[-2:]
        cells = [label, total, len(ids), complete, coverage['rows'], *(coverage[field] for field in FIELDS)]
        lines.append('| ' + ' | '.join(map(str, cells)) + ' |')
    lines.extend((
        '',
        f'Richieste API usate: {client.requests}/{MAX_REQUESTS}.',
        '',
        'I conteggi coprono le righe dei titolari riportati e dei subentrati con minuti positivi. '
        'Uno zero numerico conta come presente. Il campione verifica la presenza dei campi '
        'e non certifica la completezza della stagione o l’accuratezza dei valori.',
    ))
    return '\n'.join(lines) + '\n'


def main():
    key = os.environ.get('YUVRON_RAPIDAPI_KEY', '').strip()
    if not key:
        print('Configura il segreto YUVRON_RAPIDAPI_KEY prima di eseguire il test.', file=sys.stderr)
        return 1
    try:
        report = coverage_report(YuvronProbe(key))
    except DataError as error:
        print(f'Verifica Yuvron interrotta. {error}', file=sys.stderr)
        if error.status in (401, 403):
            print('Controlla la chiave RapidAPI e il piano attivo per il prodotto Serie A.', file=sys.stderr)
        if error.status == 429:
            print('Quota o frequenza RapidAPI raggiunta.', file=sys.stderr)
        return 1
    print(report, end='')
    if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
        with Path(summary).open('a', encoding='utf-8') as output:
            output.write(report)
    return 0


if __name__ == '__main__':
    sys.exit(main())
