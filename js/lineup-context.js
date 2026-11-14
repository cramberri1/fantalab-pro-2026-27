const UPCOMING = new Set(['scheduled', 'timed', 'upcoming', 'tbd', 'ns', 'not started']);
const AVAILABILITY = {
  out: 'Indisponibile',
  doubtful: 'In dubbio',
  available: 'Disponibile',
  reported: 'Segnalazione da verificare',
  unknown: 'Disponibilità non verificata'
};
const PAST_REPORTS = {
  out: 'Indisponibilità segnalata per la gara',
  doubtful: 'Dubbio segnalato per la gara',
  available: 'Disponibilità segnalata per la gara',
  reported: 'Segnalazione per la gara'
};

export function buildLineupContext(players, {
  fixtures = [], absences = [], round, getTeam, getPlayerFixture, getAvailability,
  isUpcoming = fixture => UPCOMING.has(String(fixture.status ?? '').trim().toLowerCase())
}) {
  const fixturesByTeam = new Map();
  const matchReports = new Map();
  for (const report of absences) {
    const key = String(report.fixtureId);
    const rows = matchReports.get(key) ?? [];
    rows.push(report);
    matchReports.set(key, rows);
  }
  return new Map(players.map(player => {
    if (!fixturesByTeam.has(player.teamId)) {
      fixturesByTeam.set(player.teamId, getPlayerFixture(player, fixtures, round));
    }
    const fixture = fixturesByTeam.get(player.teamId);
    const home = fixture?.homeId === player.teamId;
    const opponent = fixture ? getTeam(home ? fixture.awayId : fixture.homeId) : null;
    const opponentName = opponent?.shortName ?? opponent?.name ?? null;
    const venue = fixture ? (home ? 'Casa' : 'Trasferta') : null;
    const opponentLabel = opponent?.name ?? opponentName;
    const fixtureLabel = fixture
      ? `${opponentLabel ? `Contro ${opponentLabel}` : 'Avversario non acquisito'} · ${venue === 'Casa' ? 'In casa' : 'In trasferta'}`
      : 'Partita non acquisita';
    const upcoming = fixture && isUpcoming(fixture);
    const subject = upcoming ? player : { id: player.id };
    const { status, reason } = getAvailability(subject, fixture, matchReports.get(String(fixture?.id)) ?? []);
    const label = (upcoming ? AVAILABILITY[status] : PAST_REPORTS[status]) ?? AVAILABILITY.unknown;
    return [player.id, { opponentName, venue, fixtureLabel, availability: { status, reason, label } }];
  }));
}
