"""Add settled scores from the attributed Football Analytics open export."""

from datetime import date, datetime, timezone
import hashlib
from zoneinfo import ZoneInfo

from update_data import DataError, YEAR, decode, fetch


FOOTBALLANALYTICS_ID = 'footballanalytics'
FOOTBALLANALYTICS_URL = 'https://footballanalytics.pro/data/serie-a.json'
FOOTBALLANALYTICS_CREDIT = 'https://footballanalytics.pro/en/data'
FOOTBALLANALYTICS_LICENSE = 'https://creativecommons.org/licenses/by/4.0/'
VERIFIED_CLUB_SOURCE_ID = 'verified-club-results'
VERIFIED_CLUB_RESULTS = (
    ('napoli-frosinone', '2026-10-10', 3, 0,
     'https://sscnapoli.it/en/match-report-napoli-frosinone-3-0/',
     'https://www.frosinonecalcio.com/conferenza-stampa-post-partita-giacomo-calo/'),
    ('lazio-monza', '2026-10-11', 3, 1,
     'https://www.sslazio.it/it/news/match-report/serie-a-enilive-or-lazio-monza-le-formazioni-ufficiali-a',
     'https://www.acmonza.com/it/news/lazio-monza-report-11102026/'),
    ('atalanta-venezia', '2026-10-12', 3, 1,
     'https://www.veneziafc.it/news/il-post-partita-di-atalanta-venezia',
     'https://www.atalanta.it/partite-e-risultati/prima-squadra/index'),
    ('frosinone-sassuolo', '2026-10-16', 4, 2,
     'https://www.frosinonecalcio.com/frosinone-sassuolo-4-2/',
     'https://www.sassuolocalcio.it/sassuolo-channel-tv/serie-a-enilive-gli-highlights-di-frosinone-sassuolo-4-2/'),
    ('venezia-napoli', '2026-10-17', 1, 0,
     'https://www.veneziafc.it/news/il-post-partita-di-venezia-napoli',
     'https://sscnapoli.it/match-report-venezia-napoli-1-0/'),
    ('monza-cagliari', '2026-10-19', 4, 0,
     'https://www.acmonza.com/it/news/monza-cagliari-report-19102026/',
     'https://cagliaricalcio.com/news/match-report-monza-cagliari-4-0/'),
)


def parse_timestamp(value):
    if not isinstance(value, str):
        raise DataError('Timestamp mancante nell’export Football Analytics.')
    try:
        stamp = datetime.fromisoformat(value)
    except ValueError:
        raise DataError('Timestamp non valido nell’export Football Analytics.') from None
    if stamp.utcoffset() is None:
        raise DataError('Timestamp senza fuso nell’export Football Analytics.')
    return stamp


def parse_results(raw, now, rome):
    payload = decode(raw)
    if not isinstance(payload, dict) or payload.get('name') != 'serie-a':
        raise DataError('L’export Football Analytics non corrisponde alla Serie A.')
    if payload.get('license') != FOOTBALLANALYTICS_LICENSE:
        raise DataError('Licenza CC BY 4.0 assente nell’export Football Analytics.')
    rows = payload.get('data')
    if not isinstance(rows, list) or type(payload.get('rows')) is not int or payload['rows'] != len(rows):
        raise DataError('Conteggio righe incoerente nell’export Football Analytics.')
    generated = parse_timestamp(payload.get('generated_at'))
    season_start = date(YEAR, 7, 1)
    season_end = date(YEAR + 1, 7, 1)
    parsed = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or row.get('league_slug') != 'serie-a' or row.get('country') != 'Italy':
            raise DataError('Una riga di Football Analytics appartiene a un’altra competizione.')
        home, away = row.get('home_team'), row.get('away_team')
        if not all(isinstance(name, str) and name.strip() for name in (home, away)) or home == away:
            raise DataError('Squadre non valide nell’export Football Analytics.')
        kickoff = parse_timestamp(row.get('kickoff_utc')).astimezone(rome)
        if not season_start <= kickoff.date() < season_end:
            continue
        score = row.get('home_score'), row.get('away_score')
        if kickoff > now or not all(type(value) is int and value >= 0 for value in score):
            raise DataError('Risultato finale non valido nell’export Football Analytics.')
        key = home.strip().casefold(), away.strip().casefold()
        if key in seen:
            raise DataError('Incontri duplicati nell’export Football Analytics.')
        seen.add(key)
        parsed.append((key, kickoff, score))
    return parsed, generated


def add_footballanalytics(snapshot, now, raw=None):
    if raw is None:
        raw, _ = fetch(FOOTBALLANALYTICS_URL)
    rome = ZoneInfo('Europe/Rome')
    rows, generated = parse_results(raw, now, rome)
    labels = {team['id']: team['shortName'].strip().casefold() for team in snapshot['teams']}
    fixtures = {(labels[f['homeId']], labels[f['awayId']]): f for f in snapshot['fixtures']}
    compared = conflicts = unmatched = added = 0
    accepted_dates = []
    for key, kickoff, score in rows:
        fixture = fixtures.get(key)
        kickoff_date = kickoff.date().isoformat()
        if not fixture or fixture['date'] != kickoff_date:
            unmatched += 1
            continue
        if fixture['status'] == 'played':
            if (fixture['homeGoals'], fixture['awayGoals']) != score:
                conflicts += 1
                continue
            if fixture.get('resultSourceId') != FOOTBALLANALYTICS_ID:
                compared += 1
        else:
            fixture.update(status='played', homeGoals=score[0], awayGoals=score[1],
                           resultSourceId=FOOTBALLANALYTICS_ID)
            added += 1
        if fixture['kickoff'] is None:
            fixture['kickoff'] = kickoff.isoformat()
            fixture['kickoffSourceId'] = FOOTBALLANALYTICS_ID
        accepted_dates.append(kickoff_date)

    refresh_result_coverage(snapshot)
    source = {
        'id': FOOTBALLANALYTICS_ID, 'name': 'Football Analytics',
        'url': FOOTBALLANALYTICS_CREDIT, 'dataUrl': FOOTBALLANALYTICS_URL,
        'license': 'CC-BY-4.0', 'licenseUrl': FOOTBALLANALYTICS_LICENSE,
        'retrievedAt': now.astimezone(timezone.utc).isoformat(timespec='seconds'),
        'generatedAt': generated.astimezone(timezone.utc).isoformat(timespec='seconds'),
        'contentSha256': hashlib.sha256(raw).hexdigest(),
        'latestResultDate': max(accepted_dates, default=None),
        'settledRows': len(rows), 'matchedOtherSources': compared,
        'addedResults': added, 'conflictingResults': conflicts, 'unmatchedResults': unmatched,
        'modifications': 'Solo risultati finali e orari mancanti. Unione con il calendario per squadre e data italiana.',
    }
    replace_source(snapshot, source)
    return source


def refresh_result_coverage(snapshot):
    finals = any(f['status'] == 'played' for f in snapshot['fixtures'])
    missing = any(f['status'] == 'unknown' for f in snapshot['fixtures'])
    snapshot['coverage']['results'] = 'missing' if not finals else 'partial' if missing else 'available'


def replace_source(snapshot, source):
    snapshot['sources'] = [row for row in snapshot['sources'] if row['id'] != source['id']]
    snapshot['sources'].append(source)


def add_verified_results(snapshot, now):
    """Fill specific historical gaps from individual match reports of both clubs."""
    today = now.astimezone(ZoneInfo('Europe/Rome')).date().isoformat()
    fixtures = {f['id']: f for f in snapshot['fixtures']}
    references = []
    added = conflicts = matched = 0
    for fixture_id, day, home, away, primary, confirmation in VERIFIED_CLUB_RESULTS:
        fixture = fixtures.get(fixture_id)
        if not fixture or fixture['date'] != day or day >= today:
            continue
        if fixture['status'] == 'played':
            if (fixture['homeGoals'], fixture['awayGoals']) != (home, away):
                conflicts += 1
                continue
            matched += int(fixture.get('resultSourceId') != VERIFIED_CLUB_SOURCE_ID)
        else:
            fixture.update(status='played', homeGoals=home, awayGoals=away,
                           resultSourceId=VERIFIED_CLUB_SOURCE_ID, resultReferenceUrl=primary)
            added += 1
        references.append({'fixtureId': fixture_id, 'date': day, 'url': primary, 'confirmationUrl': confirmation})
    refresh_result_coverage(snapshot)
    source = {
        'id': VERIFIED_CLUB_SOURCE_ID, 'name': 'Riscontri dai club',
        'url': 'https://github.com/cramberri1/fantalab-pro-2026-27/blob/main/docs/FONTI.md',
        'verifiedDate': '2026-11-12',
        'latestResultDate': max((row['date'] for row in references), default=None),
        'addedResults': added, 'matchedOtherSources': matched, 'conflictingResults': conflicts,
        'references': references,
        'modifications': 'Singoli risultati verificati sui resoconti pubblici di entrambi i club. Controllo manuale.',
    }
    if references or conflicts:
        replace_source(snapshot, source)
    return source
