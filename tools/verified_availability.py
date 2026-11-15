"""Merge individually reviewed availability reports into the pending fixtures."""

from collections import defaultdict
from datetime import date, datetime
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from update_data import DataError, SEASON, decode


DISCIPLINE_SOURCE = 'serie-a-disciplinary'
AVAILABILITY_SOURCE = 'verified-availability'
SOURCE_IDS = {DISCIPLINE_SOURCE, AVAILABILITY_SOURCE}
STATUSES = {'out', 'doubtful', 'reported', 'available', 'suspended'}


def report_date(value):
    if not isinstance(value, str):
        raise DataError('Data della segnalazione di disponibilità mancante.')
    try:
        result = date.fromisoformat(value)
    except ValueError:
        raise DataError('Data della segnalazione di disponibilità non valida.') from None
    if result.isoformat() != value:
        raise DataError('La data della segnalazione di disponibilità deve essere YYYY-MM-DD.')
    return result


def report_hostname(value):
    if not isinstance(value, str) or any(character.isspace() for character in value):
        raise DataError('URL della segnalazione di disponibilità non valido.')
    try:
        url = urlsplit(value)
        if url.scheme != 'https' or not url.hostname or url.username is not None or url.port not in (None, 443):
            raise ValueError
    except ValueError:
        raise DataError('La segnalazione di disponibilità richiede un URL HTTPS senza credenziali.') from None
    return url.hostname


def parse_reports(raw):
    payload = decode(raw)
    if not isinstance(payload, dict) or type(payload.get('schemaVersion')) is not int or payload['schemaVersion'] != 1 or \
            payload.get('season') != SEASON or not isinstance(payload.get('reports'), list):
        raise DataError('Formato o stagione non validi per le segnalazioni di disponibilità.')

    seen = set()
    for row in payload['reports']:
        if not isinstance(row, dict) or not all(isinstance(row.get(field), str) and row[field].strip() == row[field] and row[field]
            for field in ('playerId', 'playerName', 'teamId', 'fixtureId', 'kind', 'status', 'reason', 'sourceName')):
            raise DataError('Campi obbligatori non validi in una segnalazione di disponibilità.')
        if type(row.get('round')) is not int or not 1 <= row['round'] <= 38 or row['status'] not in STATUSES or \
                row['kind'] not in ('injury', 'fitness', 'suspension') or (row['kind'] == 'suspension') != (row['status'] == 'suspended'):
            raise DataError('Giornata, tipo o stato non valido in una segnalazione di disponibilità.')
        if len(row['sourceName']) > 100 or len(row['reason']) > 160 or any(not character.isprintable() for character in row['reason']):
            raise DataError('Usare una fonte e una motivazione fattuale breve nella segnalazione di disponibilità.')
        published = report_date(row.get('publishedAt'))
        hostname = report_hostname(row.get('sourceUrl'))
        if row['kind'] == 'suspension' and hostname != 'legaseriea.it' and not hostname.endswith('.legaseriea.it'):
            raise DataError('Una squalifica richiede il comunicato ufficiale della Lega Serie A.')
        key = (row['playerId'], row['fixtureId'], row['sourceUrl'], row['publishedAt'])
        if key in seen:
            raise DataError('Segnalazione di disponibilità duplicata nella stessa fonte.')
        seen.add(key)
        yield row, published


def merge_reports(snapshot, raw, now):
    """Prefer a specific, reviewed report over the same fixture's generic feed entry."""
    parsed = list(parse_reports(raw))
    today = now.astimezone(ZoneInfo('Europe/Rome')).date()
    players = {row['id']: row for row in snapshot['players']}
    fixtures = {row['id']: row for row in snapshot['fixtures']}
    candidates = defaultdict(list)
    counts = {'applied': 0, 'unmatched': 0, 'inactive': 0, 'conflicts': 0}
    for row, published in parsed:
        fixture = fixtures.get(row['fixtureId'])
        player = players.get(row['playerId'])
        if not fixture or not player or (player['name'], player['teamId']) != (row['playerName'], row['teamId']) or \
                fixture['round'] != row['round'] or row['teamId'] not in (fixture['homeId'], fixture['awayId']):
            counts['unmatched'] += 1
            continue
        kickoff = datetime.fromisoformat(fixture['kickoff']) if fixture['kickoff'] else None
        if fixture['status'] != 'scheduled' or date.fromisoformat(fixture['date']) < today or \
                (kickoff is not None and kickoff <= now) or published > today:
            counts['inactive'] += 1
            continue
        candidates[(row['playerId'], row['fixtureId'])].append(row)

    absences = {(row['playerId'], row['fixtureId']): row for row in snapshot['absences'] if row.get('sourceId') not in SOURCE_IDS}
    sources = {}
    for key, reports in candidates.items():
        shortlisted = [row for row in reports if row['kind'] == 'suspension'] or reports
        latest = max(row['publishedAt'] for row in shortlisted)
        current = sorted((row for row in shortlisted if row['publishedAt'] == latest), key=lambda row: row['sourceUrl'])
        source_id = DISCIPLINE_SOURCE if current[0]['kind'] == 'suspension' else AVAILABILITY_SOURCE
        chosen = {field: current[0][field] for field in ('playerId', 'teamId', 'fixtureId', 'kind', 'status',
                  'reason', 'sourceName', 'sourceUrl', 'publishedAt')}
        if len({row['status'] for row in current}) > 1:
            counts['conflicts'] += 1
            chosen.update(status='reported', reason='Aggiornamenti discordanti da verificare.', references=[
                {'sourceName': row['sourceName'], 'sourceUrl': row['sourceUrl']} for row in current
            ])
        chosen['sourceId'] = source_id
        absences[key] = chosen
        if source_id not in sources or latest > sources[source_id]['updatedAt']:
            name = 'Lega Serie A · Giudice Sportivo' if source_id == DISCIPLINE_SOURCE else 'Indisponibilità verificate'
            sources[source_id] = {'id': source_id, 'name': name, 'url': chosen['sourceUrl'], 'updatedAt': latest,
                                  'note': 'Segnalazioni puntuali verificate. La copertura delle squadre è parziale.'}
        counts['applied'] += 1

    snapshot['absences'] = sorted(absences.values(), key=lambda row: (row['fixtureId'], row['playerId']))
    snapshot['sources'] = [row for row in snapshot['sources'] if row['id'] not in SOURCE_IDS] + list(sources.values())
    snapshot['coverage']['absences'] = 'partial' if absences else 'missing'
    return counts
