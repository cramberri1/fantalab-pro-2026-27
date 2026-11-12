"""Refresh the unified Serie A snapshot. Python 3.11+; standard library only."""

import argparse
from collections import Counter
from datetime import date, datetime, time, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
from tempfile import NamedTemporaryFile
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zoneinfo import ZoneInfo


SEASON = '2026/27'
YEAR = 2026
OPEN_URL = 'https://raw.githubusercontent.com/openfootball/football.json/master/2026-27/it.1.json'
OPEN_LICENSE = 'https://github.com/openfootball/football.json/blob/master/LICENSE.md'
ROSTER_URL = 'https://transferbeat.com/data/fanta/listone.json'
ROSTER_CREDIT = 'https://transferbeat.com/fantacalcio/listone.html'
ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / 'data' / 'serie-a-2026-27.json'
CLUBS = {
    'AC Milan': ('milan', 'Milan'),
    'AC Monza': ('monza', 'Monza'),
    'ACF Fiorentina': ('fiorentina', 'Fiorentina'),
    'AS Roma': ('roma', 'Roma'),
    'Atalanta BC': ('atalanta', 'Atalanta'),
    'Bologna FC 1909': ('bologna', 'Bologna'),
    'Cagliari Calcio': ('cagliari', 'Cagliari'),
    'Como 1907': ('como', 'Como'),
    'FC Internazionale Milano': ('inter', 'Inter'),
    'Frosinone Calcio': ('frosinone', 'Frosinone'),
    'Genoa CFC': ('genoa', 'Genoa'),
    'Juventus FC': ('juventus', 'Juventus'),
    'Parma Calcio 1913': ('parma', 'Parma'),
    'SS Lazio': ('lazio', 'Lazio'),
    'SSC Napoli': ('napoli', 'Napoli'),
    'Torino FC': ('torino', 'Torino'),
    'US Lecce': ('lecce', 'Lecce'),
    'US Sassuolo Calcio': ('sassuolo', 'Sassuolo'),
    'Udinese Calcio': ('udinese', 'Udinese'),
    'Venezia FC': ('venezia', 'Venezia'),
}


class DataError(ValueError):
    """A source failed verification and the previous snapshot must be preserved."""

    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward authorization headers to a redirect destination.
        return None


def fetch(url, headers=None, limit=12_000_000):
    request = Request(url, headers={'Accept': 'application/json', 'User-Agent': 'FantaLab-Pro/1', **(headers or {})})
    try:
        with build_opener(NoRedirect()).open(request, timeout=35) as response:
            raw = response.read(limit + 1)
            if len(raw) > limit:
                raise DataError('La risposta della fonte supera il limite previsto.')
            return raw, response.headers
    except HTTPError as error:
        raise DataError(f'Richiesta alla fonte rifiutata (HTTP {error.code}).', status=error.code) from None
    except (URLError, TimeoutError):
        raise DataError('La fonte non risponde o non è raggiungibile.') from None


def decode(raw):
    try:
        return json.loads(raw.decode('utf-8-sig'), parse_constant=reject_nonfinite)
    except (UnicodeError, json.JSONDecodeError):
        raise DataError('La fonte non contiene JSON UTF-8 valido.') from None


def reject_nonfinite(value):
    raise DataError('Valore numerico non finito nel JSON.')


def make_snapshot(raw, now):
    source = decode(raw)
    if source.get('name') != 'Italian Serie A 2026/27' or len(source.get('matches', [])) != 380:
        raise DataError('Il calendario OpenFootball non corrisponde alle 380 partite attese.')

    rome = ZoneInfo('Europe/Rome')
    today = now.astimezone(rome).date()
    teams = [{'id': slug, 'name': name, 'shortName': short_name} for name, (slug, short_name) in CLUBS.items()]
    fixtures = []
    for match in source['matches']:
        round_label = re.fullmatch(r'Matchday ([1-9][0-9]?)', match['round'])
        if not round_label:
            raise DataError('Formato della giornata OpenFootball inatteso.')
        round_number = int(round_label[1])
        home_id = CLUBS[match['team1']][0]
        away_id = CLUBS[match['team2']][0]
        day = date.fromisoformat(match['date'])
        if not date(2026, 7, 1) <= day < date(2027, 7, 1):
            raise DataError('Una partita è fuori dalla stagione richiesta.')
        hour = match.get('time')
        kickoff = datetime.combine(day, time.fromisoformat(hour), rome) if hour else None
        score = (match.get('score') or {}).get('ft')
        if score is not None and (len(score) != 2 or not all(nonnegative(x) and type(x) is int for x in score)):
            raise DataError('Risultato finale OpenFootball non valido.')
        if score is not None and (day > today or kickoff is not None and kickoff > now):
            raise DataError('La fonte ha assegnato un risultato finale a una partita futura.')
        elapsed = day < today or (kickoff is not None and kickoff <= now)
        fixtures.append({
            'id': f'{home_id}-{away_id}', 'round': round_number,
            'date': day.isoformat(), 'kickoff': kickoff.isoformat() if kickoff else None,
            'homeId': home_id, 'awayId': away_id,
            'status': 'played' if score is not None else 'unknown' if elapsed else 'scheduled',
            'homeGoals': score[0] if score is not None else None,
            'awayGoals': score[1] if score is not None else None,
            'homeXg': None, 'awayXg': None,
        })

    round_teams = Counter((f['round'], club_id) for f in fixtures for club_id in (f['homeId'], f['awayId']))
    if len(round_teams) != 760 or any(count != 1 for count in round_teams.values()):
        raise DataError('Il calendario non ha una partita per club in ciascuna giornata.')

    stamp = now.astimezone(timezone.utc).isoformat(timespec='seconds')
    final_scores = [f['date'] for f in fixtures if f['status'] == 'played']
    return {
        'schemaVersion': 1, 'season': SEASON, 'mode': 'real', 'updatedAt': stamp,
        'sources': [{
            'id': 'openfootball', 'name': 'OpenFootball', 'url': OPEN_URL,
            'license': 'CC0-1.0', 'licenseUrl': OPEN_LICENSE, 'retrievedAt': stamp,
            'contentSha256': hashlib.sha256(raw).hexdigest(),
            'latestResultDate': max(final_scores, default=None),
        }],
        'coverage': {
            'fixtures': 'available',
            'results': 'missing' if not final_scores else 'partial' if any(f['status'] == 'unknown' for f in fixtures) else 'available',
            'players': 'missing', 'expectedGoals': 'missing', 'expectedAssists': 'missing',
            'absences': 'missing', 'teamStats': 'missing',
        },
        'teams': sorted(teams, key=lambda x: x['shortName']),
        'fixtures': sorted(fixtures, key=lambda x: (x['round'], x['date'], x['kickoff'] or '', x['id'])),
        'players': [], 'absences': [],
    }


def calculate_team_stats(snapshot):
    fixtures = [f for f in snapshot['fixtures'] if f['status'] == 'played']
    for team in snapshot['teams']:
        home = [f for f in fixtures if f['homeId'] == team['id']]
        away = [f for f in fixtures if f['awayId'] == team['id']]
        samples = len(home) + len(away)
        goals_for = [f['homeGoals'] for f in home] + [f['awayGoals'] for f in away]
        goals_against = [f['awayGoals'] for f in home] + [f['homeGoals'] for f in away]
        xg = [f.get('homeXg') for f in home] + [f.get('awayXg') for f in away]
        xga = [f.get('awayXg') for f in home] + [f.get('homeXg') for f in away]
        team['stats'] = {
            'matches': samples or None, 'goalsFor': sum(goals_for) if samples else None,
            'goalsAgainst': sum(goals_against) if samples else None,
            'xg': round(sum(xg), 3) if samples and None not in xg else None,
            'xga': round(sum(xga), 3) if samples and None not in xga else None,
        }
    if fixtures:
        snapshot['coverage']['teamStats'] = snapshot['coverage']['results']


def add_roster(snapshot, raw, now):
    roster = decode(raw)
    if roster.get('season') != YEAR or not isinstance(roster.get('players'), list):
        raise DataError('Listone TransferBeat di stagione diversa o formato inatteso.')
    validate_timestamp(roster['updated'])
    clubs = {t['shortName']: t['id'] for t in snapshot['teams']}
    clubs.update({'AC Milan': 'milan', 'AS Roma': 'roma'})
    positions = {'P': 'GK', 'D': 'DEF', 'C': 'MID', 'A': 'FWD'}
    players = []
    for row in roster['players']:
        if type(row['id']) is not int or row['id'] < 1 or not row['name'].strip():
            raise DataError('Identificativo o nome TransferBeat non valido.')
        team_id = clubs.get(row['team'])
        if not team_id or row['role'] not in positions or not nonnegative(row['price']):
            raise DataError('Squadra, ruolo o quotazione TransferBeat non validi.')
        players.append({
            'id': f"tb-{row['id']}", 'name': row['name'].strip(), 'teamId': team_id,
            'position': positions[row['role']], 'editorialPrice': row['price'],
            'appearances': None, 'starts': None, 'minutes': None, 'goals': None,
            'assists': None, 'shots': None, 'yellowCards': None,
            'xg': None, 'xa': None, 'npxg': None, 'injuryStatus': None, 'injuryReason': None,
        })
    if len(players) < 400 or len({p['teamId'] for p in players}) != len(snapshot['teams']):
        raise DataError('Il listone TransferBeat è incompleto.')
    snapshot['players'] = sorted(players, key=lambda p: (p['teamId'], p['name'].casefold(), p['id']))
    snapshot['coverage']['players'] = 'available'
    snapshot['coverage']['playerStats'] = 'missing'
    snapshot['sources'].append({
        'id': 'transferbeat', 'name': 'TransferBeat · FantaTB', 'url': ROSTER_CREDIT,
        'dataUrl': ROSTER_URL, 'license': 'CC-BY-4.0',
        'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/',
        'updatedAt': roster['updated'], 'retrievedAt': now.isoformat(timespec='seconds'),
        'contentSha256': hashlib.sha256(raw).hexdigest(),
        'modifications': 'Squadre e ruoli Classic normalizzati. Quotazioni editoriali FantaTB in crediti.',
    })


def nonnegative(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def row_index(rows, label):
    index = {}
    for row in rows:
        row_id = row['id']
        if not isinstance(row_id, str) or not row_id or row_id in index:
            raise DataError(f'Identificativo duplicato o non valido in {label}.')
        index[row_id] = row
    return index


def validate(snapshot):
    from ratings import validate_ratings

    if (snapshot['schemaVersion'], snapshot['season'], snapshot['mode']) != (1, SEASON, 'real'):
        raise DataError('Schema, stagione o tipo di dati errati.')
    if snapshot['updatedAt'] is not None:
        validate_timestamp(snapshot['updatedAt'])
    for key in ('fixtures', 'players', 'expectedGoals', 'expectedAssists', 'absences'):
        if key not in snapshot['coverage']:
            raise DataError(f'Indicatore di copertura mancante: {key}.')
    if any(value not in ('available', 'partial', 'missing') for value in snapshot['coverage'].values()):
        raise DataError('Valore di copertura sconosciuto.')

    teams = row_index(snapshot['teams'], 'squadre')
    fixtures = row_index(snapshot['fixtures'], 'partite')
    players = row_index(snapshot['players'], 'giocatori')
    sources = row_index(snapshot['sources'], 'fonti')
    for source in sources.values():
        if not source.get('name') or not source['url'].startswith('https://'):
            raise DataError('Una fonte non ha nome o URL HTTPS.')
        if source.get('retrievedAt'):
            validate_timestamp(source['retrievedAt'])

    for fixture in fixtures.values():
        if fixture['homeId'] not in teams or fixture['awayId'] not in teams or fixture['homeId'] == fixture['awayId']:
            raise DataError('Una partita ha squadre non valide.')
        if type(fixture['round']) is not int or not 1 <= fixture['round'] <= 38:
            raise DataError('Giornata fuori intervallo.')
        date.fromisoformat(fixture['date'])
        if fixture['kickoff'] is not None:
            validate_timestamp(fixture['kickoff'])
        if fixture['status'] not in ('played', 'scheduled', 'unknown'):
            raise DataError('Stato partita sconosciuto.')
        score = (fixture['homeGoals'], fixture['awayGoals'])
        if fixture['status'] == 'played' and not all(type(x) is int and x >= 0 for x in score):
            raise DataError('Risultato finale incompleto.')
        if fixture['status'] != 'played' and score != (None, None):
            raise DataError('Partita non conclusa con risultato finale.')
        validate_metrics(fixture, ('homeXg', 'awayXg'))

    for player in players.values():
        if player['teamId'] not in teams or player['position'] not in ('GK', 'DEF', 'MID', 'FWD', None):
            raise DataError('Squadra o ruolo giocatore sconosciuto.')
        validate_metrics(player, ('appearances', 'starts', 'minutes', 'goals', 'assists', 'xg', 'xa', 'npxg', 'shots', 'yellowCards'))
        validate_ratings(player)
        seen = set()
        for row in player.get('history', []):
            fixture_id = row['fixtureId']
            if (fixture_id in seen or fixture_id not in fixtures or row['round'] != fixtures[fixture_id]['round']
                    or fixtures[fixture_id]['status'] != 'played'):
                raise DataError('Partita non valida nello storico giocatore.')
            seen.add(fixture_id)
            validate_metrics(row, ('minutes', 'goals', 'assists', 'xg', 'xa'))

    seen_absences = set()
    for row in snapshot['absences']:
        fixture = fixtures.get(row['fixtureId'])
        key = (row['playerId'], row['fixtureId'])
        if (key in seen_absences or row['playerId'] not in players or not fixture
                or row['teamId'] not in (fixture['homeId'], fixture['awayId'])
                or row['status'] not in ('out', 'doubtful', 'reported')):
            raise DataError('Indisponibilità duplicata o senza riferimenti validi.')
        seen_absences.add(key)


def validate_timestamp(value):
    if datetime.fromisoformat(value).utcoffset() is None:
        raise DataError('Timestamp senza fuso orario.')


def validate_metrics(row, fields):
    if any(row.get(field) is not None and not nonnegative(row[field]) for field in fields):
        raise DataError('Valore statistico negativo o non numerico.')


def write_atomic(path, snapshot):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = None
    try:
        with NamedTemporaryFile('w', dir=path.parent, encoding='utf-8', newline='\n', delete=False) as output:
            tmp = Path(output.name)
            json.dump(snapshot, output, ensure_ascii=False, indent=2, allow_nan=False)
            output.write('\n')
        os.replace(tmp, path)
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--openfootball-file', type=Path, help='Snapshot originale OpenFootball, per aggiornare offline.')
    parser.add_argument('--roster-file', type=Path, help='Listone originale TransferBeat, per aggiornare offline.')
    parser.add_argument('--ratings-dir', type=Path, help='Cartella con le rilevazioni originali TransferBeat, per aggiornare offline.')
    parser.add_argument('--calendar-only', action='store_true', help='Importa il solo calendario OpenFootball.')
    parser.add_argument('--output', type=Path, default=SNAPSHOT)
    parser.add_argument('--validate-only', type=Path, metavar='SNAPSHOT')
    parser.add_argument('--with-api-football', action='store_true', help='Richiede API_FOOTBALL_KEY e API_FOOTBALL_PUBLISH_ALLOWED=true.')
    parser.add_argument('--with-metrics', action='store_true', help='Richiede FANTALAB_METRICS_FILE o FANTALAB_METRICS_URL e METRICS_PUBLISH_ALLOWED=true.')
    args = parser.parse_args()
    try:
        if args.validate_only:
            validate(decode(args.validate_only.read_bytes()))
            print('Snapshot Serie A valido.')
            return 0
        now = datetime.now(timezone.utc)
        raw = args.openfootball_file.read_bytes() if args.openfootball_file else fetch(OPEN_URL)[0]
        snapshot = make_snapshot(raw, now)
        if not args.calendar_only:
            roster = args.roster_file.read_bytes() if args.roster_file else fetch(ROSTER_URL)[0]
            add_roster(snapshot, roster, now)
            from ratings import add_ratings
            if args.roster_file and not args.ratings_dir:
                print('Voti saltati. Usare --ratings-dir per aggiungere i file offline.')
            else:
                add_ratings(snapshot, now, args.ratings_dir)
        if args.with_api_football or args.with_metrics:
            from licensed import enrich_api_football, enrich_metrics
            if args.with_api_football:
                enrich_api_football(snapshot, now)
            if args.with_metrics:
                enrich_metrics(snapshot)
        calculate_team_stats(snapshot)
        validate(snapshot)
        write_atomic(args.output, snapshot)
        print(f"Snapshot aggiornato. {len(snapshot['fixtures'])} partite, {len(snapshot['players'])} giocatori, {len(snapshot['absences'])} segnalazioni.")
        return 0
    except (DataError, KeyError, TypeError, ValueError, AttributeError, OSError) as error:
        message = str(error) if isinstance(error, DataError) else type(error).__name__
        print(f'Aggiornamento interrotto. {message} Il file precedente resta disponibile.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    # Adapter imports share this module's DataError and helper functions.
    sys.modules['update_data'] = sys.modules[__name__]
    raise SystemExit(main())
