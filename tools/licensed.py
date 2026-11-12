"""Optional enrichments from authorized providers. No credentials enter the snapshot."""

from collections import defaultdict
from datetime import date
import os
from pathlib import Path
import unicodedata
from urllib.parse import urlencode, urlsplit

from update_data import DataError, YEAR, SEASON, decode, fetch, nonnegative, row_index, validate_metrics, validate_timestamp


API_ROOT = 'https://v3.football.api-sports.io/'
API_DOCS = 'https://www.api-football.com/documentation-v3'
API_TERMS = 'https://www.api-football.com/terms'
API_LEAGUE = 135
PLAYER_FIELDS = ('appearances', 'starts', 'minutes', 'goals', 'assists', 'shots', 'yellowCards')
METRICS = ('xg', 'xa', 'npxg')


class FootballAPI:
    def __init__(self, key, budget):
        self.key = key
        self.remaining = budget

    def get(self, endpoint, **params):
        if self.remaining <= 0:
            raise DataError('Limite richieste API-Football raggiunto.')
        self.remaining -= 1
        raw, headers = fetch(f'{API_ROOT}{endpoint}?{urlencode(params)}', {'x-apisports-key': self.key})
        daily = headers.get('x-ratelimit-requests-remaining')
        if daily and daily.isdecimal():
            self.remaining = min(self.remaining, int(daily))
        payload = decode(raw)
        if payload.get('errors'):
            raise DataError(f'API-Football ha rifiutato {endpoint}. Verificare chiave, piano, stagione e quota.')
        rows = payload.get('response')
        if not isinstance(rows, list):
            raise DataError(f'Risposta API-Football non valida per {endpoint}.')
        return rows, payload.get('paging', {})

    def all(self, endpoint, **params):
        rows, paging = self.get(endpoint, **params)
        pages = paging.get('total', 1)
        if type(pages) is not int or pages < 0 or pages - 1 > self.remaining:
            raise DataError('Paginazione API-Football anomala o quota insufficiente.')
        for page in range(2, pages + 1):
            extra, paging = self.get(endpoint, **params, page=page)
            if paging.get('current') != page or paging.get('total') != pages or not extra:
                raise DataError('API-Football ha restituito una pagina incompleta.')
            rows.extend(extra)
        return rows


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFKD', value.casefold()) if c.isascii() and c.isalnum())


def map_clubs(snapshot, rows):
    names = {normalized(t[field]): t['id'] for t in snapshot['teams'] for field in ('name', 'shortName')}
    names.update({'internazionale': 'inter', 'internazionalemilano': 'inter'})
    clubs = {row['team']['id']: names.get(normalized(row['team']['name'])) for row in rows}
    if len(clubs) != len(snapshot['teams']) or set(clubs.values()) != {t['id'] for t in snapshot['teams']}:
        raise DataError('Le squadre API-Football non coincidono con il calendario Serie A 2026/27.')
    return clubs


def map_fixtures(snapshot, clubs, rows):
    fixtures = row_index(snapshot['fixtures'], 'partite')
    mapped = {}
    for row in rows:
        fixture_id = f"{clubs[row['teams']['home']['id']]}-{clubs[row['teams']['away']['id']]}"
        fixture = fixtures.get(fixture_id)
        provider_id = row['fixture']['id']
        if fixture is None or provider_id in mapped:
            raise DataError('Partita API-Football sconosciuta o duplicata.')
        mapped[provider_id] = fixture
        status = row['fixture']['status']['short']
        if status in ('FT', 'AET', 'PEN'):
            score = (row['goals']['home'], row['goals']['away'])
            if not all(type(x) is int and x >= 0 for x in score):
                raise DataError('Risultato finale API-Football incompleto.')
            if fixture['status'] == 'played' and (fixture['homeGoals'], fixture['awayGoals']) != score:
                raise DataError('Risultato discordante tra OpenFootball e API-Football.')
            if fixture['status'] != 'played':
                fixture.update(status='played', homeGoals=score[0], awayGoals=score[1], resultSourceId='api-football')
    coverage = snapshot['coverage']
    if any(f['status'] == 'played' for f in fixtures.values()):
        coverage['results'] = 'partial' if any(f['status'] == 'unknown' for f in fixtures.values()) else 'available'
    return mapped


def api_player_totals(stats):
    totals = {}
    for key, section, field in (
        ('appearances', 'games', 'appearences'), ('starts', 'games', 'lineups'), ('minutes', 'games', 'minutes'),
        ('goals', 'goals', 'total'), ('assists', 'goals', 'assists'),
        ('shots', 'shots', 'total'), ('yellowCards', 'cards', 'yellow'),
    ):
        values = [season.get(section, {}).get(field) for season in stats]
        totals[key] = sum(values) if values and all(nonnegative(value) for value in values) else None
    return totals


def add_player_stats(snapshot, clubs, rows):
    by_name = defaultdict(list)
    for player in snapshot['players']:
        by_name[(player['teamId'], normalized(player['name']))].append(player)

    candidates = defaultdict(dict)
    seen = set()
    for row in rows:
        profile = row['player']
        api_id = profile['id']
        if api_id in seen:
            raise DataError('Profilo duplicato nelle pagine API-Football.')
        seen.add(api_id)
        stats = [s for s in row['statistics'] if s['league']['id'] == API_LEAGUE and s['league']['season'] == YEAR]
        for season in stats:
            team = clubs.get(season['team']['id'])
            full_name = f"{profile.get('firstname') or ''} {profile.get('lastname') or ''}"
            names = {normalized(profile['name']), normalized(full_name)} - {''}
            for name in names:
                for player in by_name[(team, name)]:
                    candidates[player['id']][api_id] = (player, stats)

    reverse = defaultdict(list)
    for player_id, possible in candidates.items():
        if len(possible) == 1:
            api_id, data = next(iter(possible.items()))
            reverse[api_id].append(data)
        else:
            matching_id = int(player_id.removeprefix('tb-'))
            if matching_id in possible:
                reverse[matching_id].append(possible[matching_id])

    known = {}
    for api_id, matches in reverse.items():
        if len(matches) != 1:
            continue
        player, stats = matches[0]
        if len({s['team']['id'] for s in stats}) != len(stats):
            raise DataError('Statistiche stagionali duplicate per uno stesso giocatore e club.')
        totals = api_player_totals(stats)
        if any(value is not None for value in totals.values()):
            player.update(totals, statsSourceId='api-football')
        known[api_id] = player

    count = sum(p.get('statsSourceId') == 'api-football' for p in snapshot['players'])
    snapshot['coverage']['playerStats'] = 'partial' if count else 'missing'
    return known


def add_absences(snapshot, club_ids, fixtures, players, rows, now):
    absences = {}
    for row in rows:
        profile = row['player']
        player = players.get(profile['id'])
        fixture = fixtures.get(row['fixture']['id'])
        club = club_ids.get(row['team']['id'])
        if not player or not fixture or club not in (fixture['homeId'], fixture['awayId']):
            continue
        status = {'Missing Fixture': 'out', 'Questionable': 'doubtful'}.get(profile.get('type'), 'reported')
        key = (player['id'], fixture['id'])
        if key in absences:
            old = absences[key]
            if (old['status'], old['reason']) != (status, profile.get('reason')):
                old.update(status='reported', reason=None)
            continue
        absences[key] = {
            'playerId': player['id'], 'teamId': club, 'fixtureId': fixture['id'],
            'status': status, 'reason': profile.get('reason'), 'sourceId': 'api-football',
            'checkedAt': now.isoformat(timespec='seconds'),
        }
    snapshot['absences'] = list(absences.values())
    if absences:
        snapshot['coverage']['absences'] = 'partial'


def require_enabled(name):
    if os.environ.get(name, '').lower() != 'true':
        raise DataError(f'{name}=true è richiesto per pubblicare questa fonte.')


def enrich_api_football(snapshot, now):
    require_enabled('API_FOOTBALL_PUBLISH_ALLOWED')
    key = os.environ.get('API_FOOTBALL_KEY', '').strip()
    if not key:
        raise DataError('Impostare il segreto API_FOOTBALL_KEY.')
    budget = int(os.environ.get('API_FOOTBALL_REQUEST_BUDGET') or '75')
    if not 4 <= budget <= 150:
        raise DataError('API_FOOTBALL_REQUEST_BUDGET deve essere tra 4 e 150.')
    api = FootballAPI(key, budget)
    leagues = api.all('leagues', id=API_LEAGUE, season=YEAR)
    seasons = [s for league in leagues for s in league['seasons'] if s['year'] == YEAR and league['league']['id'] == API_LEAGUE]
    if len(seasons) != 1:
        raise DataError('L’account API-Football non ha accesso alla Serie A 2026/27.')
    capabilities = seasons[0]['coverage']
    clubs = map_clubs(snapshot, api.all('teams', league=API_LEAGUE, season=YEAR))
    fixtures = map_fixtures(snapshot, clubs, api.all('fixtures', league=API_LEAGUE, season=YEAR))
    if capabilities.get('players') and snapshot['players']:
        players = add_player_stats(snapshot, clubs, api.all('players', league=API_LEAGUE, season=YEAR))
        if capabilities.get('injuries') and players:
            add_absences(snapshot, clubs, fixtures, players, api.all('injuries', league=API_LEAGUE, season=YEAR), now)
    snapshot['sources'].append({
        'id': 'api-football', 'name': 'API-Football · API-Sports', 'url': API_DOCS,
        'license': 'Licenza del fornitore', 'licenseUrl': API_TERMS,
        'retrievedAt': now.isoformat(timespec='seconds'),
        'modifications': 'Risultati mancanti, statistiche stagionali e segnalazioni collegate a partita; identità abbinate su nome e club.',
    })


def public_url(value):
    parsed = urlsplit(value)
    return parsed.scheme == 'https' and bool(parsed.hostname) and not (parsed.username or parsed.password or parsed.query)


def metrics_input():
    local = os.environ.get('FANTALAB_METRICS_FILE')
    remote = os.environ.get('FANTALAB_METRICS_URL')
    if local and remote:
        raise DataError('Scegliere una sola sorgente per le metriche autorizzate.')
    if local:
        return decode(Path(local).read_bytes())
    if remote:
        parsed = urlsplit(remote)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
            raise DataError('FANTALAB_METRICS_URL deve essere un URL HTTPS senza credenziali nel nome host.')
        token = os.environ.get('FANTALAB_METRICS_BEARER')
        return decode(fetch(remote, {'Authorization': f'Bearer {token}'} if token else None)[0])
    raise DataError('Impostare FANTALAB_METRICS_FILE o il segreto FANTALAB_METRICS_URL.')


def merge_player_overlay(players, fixtures, rows):
    for row in row_index(rows, 'metriche giocatori').values():
        player = players[row['id']]
        for field in (*PLAYER_FIELDS, *METRICS):
            if field in row:
                player[field] = row[field]
        if any(field in row for field in (*PLAYER_FIELDS, *METRICS)):
            player['overlayStatsSourceId'] = 'metrics-overlay'
        if 'history' in row:
            player['history'] = [{
                'fixtureId': h['fixtureId'], 'round': fixtures[h['fixtureId']]['round'],
                **{field: h.get(field) for field in ('minutes', 'goals', 'assists', 'xg', 'xa')},
            } for h in row['history']]


def enrich_metrics(snapshot):
    require_enabled('METRICS_PUBLISH_ALLOWED')
    bundle = metrics_input()
    if bundle['season'] != SEASON:
        raise DataError('File metriche di una stagione diversa.')
    source = bundle['source']
    if not source['name'].strip() or not source['license'].strip() or not public_url(source['url']) or not public_url(source['licenseUrl']):
        raise DataError('Il file metriche deve identificare fornitore, licenza e URL pubblici.')
    validate_timestamp(source['updatedAt'])
    through = date.fromisoformat(source['throughDate'])
    if not date(YEAR, 7, 1) <= through < date(YEAR + 1, 7, 1):
        raise DataError('La data finale delle metriche è fuori stagione.')

    players = row_index(snapshot['players'], 'giocatori')
    fixtures = row_index(snapshot['fixtures'], 'partite')
    merge_player_overlay(players, fixtures, bundle.get('players', []))
    for row in row_index(bundle.get('fixtures', []), 'metriche partite').values():
        fixture = fixtures[row['id']]
        if fixture['status'] != 'played':
            raise DataError('xG di partita associato a un risultato finale mancante.')
        validate_metrics(row, ('homeXg', 'awayXg'))
        fixture.update(homeXg=row.get('homeXg'), awayXg=row.get('awayXg'), metricsSourceId='metrics-overlay')
    absences = {(r['playerId'], r['fixtureId']): r for r in snapshot['absences']}
    seen = set()
    for row in bundle.get('absences', []):
        key = (row['playerId'], row['fixtureId'])
        if key in seen:
            raise DataError('Il file metriche contiene un’indisponibilità duplicata.')
        seen.add(key)
        absences[key] = {field: row[field] for field in ('playerId', 'teamId', 'fixtureId', 'status')}
        absences[key].update(reason=row.get('reason'), sourceId='metrics-overlay')
    snapshot['absences'] = list(absences.values())

    coverage = snapshot['coverage']
    if any(p.get(field) is not None for p in players.values() for field in PLAYER_FIELDS):
        coverage['playerStats'] = 'partial'
    if any(p.get('xg') is not None for p in players.values()):
        coverage['expectedGoals'] = 'partial'
    if any(f.get('homeXg') is not None or f.get('awayXg') is not None for f in fixtures.values()):
        coverage['fixtureExpectedGoals'] = 'partial'
    if any(p.get('xa') is not None for p in players.values()):
        coverage['expectedAssists'] = 'partial'
    if snapshot['absences']:
        coverage['absences'] = 'partial'
    snapshot['sources'].append({
        'id': 'metrics-overlay', **{field: source[field] for field in ('name', 'url', 'license', 'licenseUrl', 'updatedAt', 'throughDate')},
    })
