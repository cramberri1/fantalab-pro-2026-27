"""Apply specific verified corrections to the pending Serie A calendar."""

from datetime import date, datetime
import json
from pathlib import Path
from zoneinfo import ZoneInfo


CORRECTIONS = Path(__file__).resolve().parents[1] / 'data' / 'verified-kickoffs.json'
ROME = ZoneInfo('Europe/Rome')


def local_kickoff(raw):
    stamp = datetime.fromisoformat(raw)
    if stamp.utcoffset() is None or stamp.isoformat() != stamp.astimezone(ROME).isoformat():
        raise ValueError('La rettifica deve indicare un orario con il fuso di Roma.')
    return stamp


def apply_verified_kickoffs(snapshot):
    from open_results import refresh_result_coverage, replace_source

    corrections = json.loads(CORRECTIONS.read_text(encoding='utf-8'))
    if snapshot['season'] != corrections['season']:
        return 0
    source = corrections['source']
    if not (source['url'].startswith('https://www.legaseriea.it/')
            and source['confirmationUrl'].startswith('https://images.legaseriea.it/')):
        raise ValueError('Rettifica senza riferimenti della Lega Serie A.')
    date.fromisoformat(source['verifiedDate'])
    now = datetime.fromisoformat(snapshot['updatedAt'])
    index = {fixture['id']: fixture for fixture in snapshot['fixtures']}
    changes = []
    seen = set()
    for row in corrections['fixtures']:
        fixture_id = row['fixtureId']
        teams = (row['homeId'], row['awayId'])
        round_number = row['round']
        if (fixture_id in seen or fixture_id != '-'.join(teams) or teams[0] == teams[1]
                or type(round_number) is not int or not 1 <= round_number <= 38):
            raise ValueError('Identità della partita non valida nella rettifica.')
        seen.add(fixture_id)
        previous, kickoff = map(local_kickoff, (row['replaces'], row['kickoff']))
        if previous == kickoff or not date(2026, 7, 1) <= kickoff.date() < date(2027, 7, 1):
            raise ValueError('Data della rettifica non valida per la stagione.')
        fixture = index.get(fixture_id)
        if not fixture or (fixture['homeId'], fixture['awayId'], fixture['round']) != (*teams, round_number):
            continue
        if fixture['status'] not in ('scheduled', 'unknown') or (fixture['homeGoals'], fixture['awayGoals']) != (None, None):
            continue
        # Keep a newer date or time from the primary source if it differs from both records.
        if fixture['date'] not in (previous.date().isoformat(), kickoff.date().isoformat()):
            continue
        if fixture['kickoff'] is not None and datetime.fromisoformat(fixture['kickoff']) != previous:
            continue
        changes.append((fixture, kickoff))

    for fixture, kickoff in changes:
        fixture.update(date=kickoff.date().isoformat(), kickoff=kickoff.isoformat(),
                       status='scheduled' if kickoff > now else 'unknown', kickoffSourceId=source['id'])
    if changes:
        refresh_result_coverage(snapshot)
        replace_source(snapshot, {**source, 'correctedFixtures': len(changes)})
        snapshot['fixtures'].sort(key=lambda fixture: (fixture['round'], fixture['date'], fixture['kickoff'] or '', fixture['id']))
    return len(changes)
