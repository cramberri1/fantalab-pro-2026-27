"""Build the 2025/26 Serie A match archive from the CC0 OpenFootball release."""

import argparse
from collections import Counter
from datetime import date
import hashlib
from pathlib import Path
import re

from update_data import CLUBS, OPEN_LICENSE, ROOT, DataError, decode, fetch, write_atomic


URL = 'https://raw.githubusercontent.com/openfootball/football.json/master/2025-26/it.1.json'
ARCHIVE_CLUBS = {
    **CLUBS,
    'US Cremonese': ('cremonese', 'Cremonese'),
    'AC Pisa 1909': ('pisa', 'Pisa'),
    'Hellas Verona FC': ('verona', 'Verona'),
}


def build_history(raw):
    source = decode(raw)
    if source.get('name') != 'Italian Serie A 2025/26' or len(source.get('matches', [])) != 380:
        raise DataError('Il calendario storico non corrisponde alla Serie A 2025/26.')
    teams = {}
    fixtures = []
    for row in source['matches']:
        round_number = re.fullmatch(r'Matchday ([1-9][0-9]?)', row['round'])
        match_date = date.fromisoformat(row['date'])
        if not round_number or not 1 <= int(round_number[1]) <= 38 or not date(2025, 7, 1) <= match_date < date(2026, 7, 1):
            raise DataError('Giornata o data fuori stagione nell’archivio storico.')
        clubs = []
        for label in (row['team1'], row['team2']):
            team_id, short = ARCHIVE_CLUBS[label]
            clubs.append(team_id)
            teams.setdefault(team_id, {'id': team_id, 'name': label, 'shortName': short})
        score = row['score'].get('ft') if isinstance(row.get('score'), dict) else row.get('score')
        if not isinstance(score, list) or len(score) != 2 or not all(type(value) is int and value >= 0 for value in score):
            raise DataError('Punteggio finale mancante o non valido nell’archivio storico.')
        fixtures.append({
            'round': int(round_number[1]), 'date': match_date.isoformat(),
            'homeId': clubs[0], 'awayId': clubs[1], 'homeGoals': score[0], 'awayGoals': score[1],
        })
    team_rounds = Counter((row['round'], row[key]) for row in fixtures for key in ('homeId','awayId'))
    if (len(teams) != 20 or len(team_rounds) != 760 or any(count != 1 for count in team_rounds.values())
            or len({(row['homeId'], row['awayId']) for row in fixtures}) != 380):
        raise DataError('Il calendario storico contiene incontri duplicati o squadre mancanti.')
    for team in teams.values():
        home = [row for row in fixtures if row['homeId'] == team['id']]
        away = [row for row in fixtures if row['awayId'] == team['id']]
        scores = [(row['homeGoals'], row['awayGoals']) for row in home] + [(row['awayGoals'], row['homeGoals']) for row in away]
        team['stats'] = {
            'matches': len(scores), 'goalsFor': sum(gf for gf, _ in scores), 'goalsAgainst': sum(ga for _, ga in scores),
            'wins': sum(gf > ga for gf,ga in scores), 'draws': sum(gf == ga for gf,ga in scores),
            'losses': sum(gf < ga for gf,ga in scores), 'homeMatches': len(home), 'awayMatches': len(away),
            'homeGoalsFor': sum(row['homeGoals'] for row in home), 'homeGoalsAgainst': sum(row['awayGoals'] for row in home),
            'awayGoalsFor': sum(row['awayGoals'] for row in away), 'awayGoalsAgainst': sum(row['homeGoals'] for row in away),
        }
    return {
        'schemaVersion': 1, 'season': '2025/26', 'mode': 'real',
        'sources': [{'id':'openfootball-history','name':'OpenFootball','url':URL,'license':'CC0-1.0','licenseUrl':OPEN_LICENSE,
                     'contentSha256':hashlib.sha256(raw).hexdigest()}],
        'coverage': {'fixtures':'available','results':'available','playerStats':'missing','expectedGoals':'missing'},
        'teams': sorted(teams.values(), key=lambda team: team['shortName']),
        'fixtures': sorted(fixtures, key=lambda row: (row['date'], row['round'], row['homeId'])),
        'players': [],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'data' / 'serie-a-2025-26.json')
    args = parser.parse_args()
    raw = args.source.read_bytes() if args.source else fetch(URL)[0]
    archive = build_history(raw)
    write_atomic(args.output, archive)
    print(f"Serie A 2025/26: {len(archive['fixtures'])} risultati e {len(archive['teams'])} squadre.")


if __name__ == '__main__':
    main()
