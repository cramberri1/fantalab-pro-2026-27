"""Merge the open calcio.it season totals with the fixture-derived team statistics."""

from datetime import date
import hashlib

from update_data import DataError, SEASON, decode, nonnegative, row_index


SOURCE = {
    'id': 'calcioit-team-xg',
    'name': 'calcio.it',
    'url': 'https://calcio.it/serie-a/tendenze',
    'license': 'CC-BY-4.0',
    'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/',
}


def apply_calcioit_team_xg(snapshot, raw):
    document = decode(raw)
    if document['season'] != SEASON or document['season'] != snapshot['season']:
        raise DataError('L’archivio degli xG di calcio.it è di un’altra stagione.')
    if document['source'] != SOURCE:
        raise DataError('Attribuzione degli xG di squadra di calcio.it non valida.')
    captured_on = date.fromisoformat(document['capturedOn'])
    if not date(2026, 7, 1) <= captured_on < date(2027, 7, 1):
        raise DataError('Data di rilevazione degli xG di calcio.it non valida.')

    teams = row_index(snapshot['teams'], 'squadre')
    totals = row_index(document['teams'], 'xG di calcio.it')
    if teams.keys() != totals.keys():
        raise DataError('Le squadre negli xG di calcio.it non coincidono con il calendario.')
    for row in totals.values():
        if (not nonnegative(row['xg']) or type(row['xgMatches']) is not int
                or not 1 <= row['xgMatches'] <= 38):
            raise DataError('Totali xG di calcio.it non validi.')
    sample = document['fixturesWithXg']
    if type(sample) is not int or sum(row['xgMatches'] for row in totals.values()) != 2 * sample:
        raise DataError('Campione degli xG di calcio.it incoerente.')

    imported = 0
    for team_id, team in teams.items():
        stats = team['stats']
        if stats.get('xg') is None:
            row = totals[team_id]
            stats.update(xg=row['xg'], xgMatches=row['xgMatches'], xgSource=SOURCE['id'])
            imported += 1

    snapshot['coverage']['teamExpectedGoals'] = 'available'
    if imported:
        snapshot['sources'].append({
            **SOURCE,
            'capturedOn': captured_on.isoformat(),
            'fixturesWithXg': sample,
            'teamsWithXg': imported,
            'seedSha256': hashlib.sha256(raw).hexdigest(),
            'modifications': 'Totali xG fatti trascritti dalla tabella aperta, con squadre e decimali normalizzati. Il campione può essere diverso da quello dei risultati.',
        })
