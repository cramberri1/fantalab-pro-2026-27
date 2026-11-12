"""Import the published FantaTB ratings without the upstream provider fields."""

from datetime import datetime
import hashlib
import math
from zoneinfo import ZoneInfo

from update_data import DataError, YEAR, decode, fetch, validate_timestamp


RATINGS_URL = 'https://transferbeat.com/data/fanta/voti-{round:02d}.json'
RATINGS_CREDIT = 'https://transferbeat.com/fantacalcio/voti.html'
VERIFIED_ARCHIVE = range(1, 6)


def read_archive(round_number, ratings_dir):
    if ratings_dir is not None:
        path = ratings_dir / f'transferbeat-voti-{round_number:02d}.json'
        return path.read_bytes() if path.is_file() else None

    try:
        return fetch(RATINGS_URL.format(round=round_number), limit=1_000_000)[0]
    except DataError as error:
        if error.status == 404 and round_number not in VERIFIED_ARCHIVE:
            return None
        raise


def validate_ratings(player):
    rounds = set()
    for row in player.get('ratings', []):
        round_number = row['round']
        if type(round_number) is not int or not 1 <= round_number <= 38 or round_number in rounds:
            raise DataError('Giornata FantaTB duplicata o non valida.')
        rounds.add(round_number)
        rating, fantasy_rating = row['rating'], row['fantasyRating']
        if rating is None and fantasy_rating is None:
            continue
        if type(rating) not in (int, float) or not 4 <= rating <= 8.5:
            raise DataError('Voto statistico FantaTB non valido.')
        if type(fantasy_rating) not in (int, float) or not math.isfinite(fantasy_rating):
            raise DataError('Fantavoto FantaTB non valido.')


def add_ratings(snapshot, now, ratings_dir=None):
    players = {player['id']: player for player in snapshot['players']}
    snapshot['coverage']['ratings'] = 'missing'
    if not players:
        return

    today = now.astimezone(ZoneInfo('Europe/Rome')).date().isoformat()
    elapsed = {fixture['round'] for fixture in snapshot['fixtures'] if fixture['date'] <= today}
    if not elapsed:
        return

    # A concluded day with a late reschedule can still appear in the archive.
    expected_rounds = range(1, max(elapsed) + 1)
    archives = []
    unmatched = 0
    unmatched_rated = 0
    ambiguous = 0
    rated_count = 0
    player_ratings = {}
    for round_number in expected_rounds:
        raw = read_archive(round_number, ratings_dir)
        if raw is None:
            continue
        archive = decode(raw)
        if archive['matchday'] != round_number or archive['total'] != 10:
            raise DataError('Archivio dei voti FantaTB di giornata diversa o formato inatteso.')
        if archive['status'] != 'rated' or archive['finished'] != archive['total']:
            continue
        validate_timestamp(archive['updated'])
        if not isinstance(archive['ratings'], list) or not archive['ratings']:
            raise DataError('Archivio FantaTB chiuso senza voti.')

        by_player = {}
        conflicting = set()
        for row in archive['ratings']:
            if row['season'] != YEAR or row['matchday'] != round_number:
                raise DataError('Una riga FantaTB è fuori stagione o giornata.')
            if row['source'] != 'fantatb-stat':
                continue
            provider_id = row['player_id']
            if type(provider_id) is not int or provider_id < 0:
                raise DataError('Identificativo del voto FantaTB non valido.')
            player_id = f'tb-{provider_id}'
            vote = {'round': round_number, 'rating': row['voto'], 'fantasyRating': row['fantavoto']}
            if player_id not in players:
                unmatched += 1
                unmatched_rated += vote['rating'] is not None
                continue

            previous = by_player.get(player_id)
            if previous is None or previous['rating'] is None:
                by_player[player_id] = vote
            elif vote['rating'] is not None and vote != previous:
                conflicting.add(player_id)

        for player_id in conflicting:
            del by_player[player_id]
        ambiguous += len(conflicting)
        for player_id, vote in by_player.items():
            player_ratings.setdefault(player_id, []).append(vote)
            rated_count += vote['rating'] is not None

        archives.append({
            'round': round_number, 'url': RATINGS_URL.format(round=round_number),
            'updatedAt': archive['updated'], 'contentSha256': hashlib.sha256(raw).hexdigest(),
        })

    if not rated_count:
        return
    for votes in player_ratings.values():
        validate_ratings({'ratings': votes})
    for player_id, votes in player_ratings.items():
        players[player_id]['ratings'] = votes
    incomplete = len(archives) != len(expected_rounds) or unmatched_rated or ambiguous
    snapshot['coverage']['ratings'] = 'partial' if incomplete else 'available'
    snapshot['sources'].append({
        'id': 'transferbeat-ratings', 'name': 'TransferBeat · Voti FantaTB', 'url': RATINGS_CREDIT,
        'license': 'CC-BY-4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/',
        'updatedAt': max((row['updatedAt'] for row in archives), key=datetime.fromisoformat),
        'retrievedAt': now.isoformat(timespec='seconds'),
        'rounds': [row['round'] for row in archives], 'archives': archives,
        'unmatchedRows': unmatched, 'unmatchedRatedRows': unmatched_rated,
        'ambiguousRatings': ambiguous, 'ratingsCount': rated_count,
        'modifications': 'Voti e fantavoti FantaTB definitivi associati al listone. Esclusi i dati grezzi e i voti provvisori.',
    })
