function canForecast(fixture, day, time, cutoff) {
  if (fixture.status !== 'scheduled') return false;
  const kickoff = Date.parse(fixture.kickoff);
  return Number.isFinite(kickoff) ? kickoff >= time : !day || day >= cutoff;
}

function cellFor(fixture, home, teams, prediction) {
  const opponentId = home ? fixture.awayId : fixture.homeId;
  const expectedFor = home ? prediction?.homeRate : prediction?.awayRate;
  const expectedAgainst = home ? prediction?.awayRate : prediction?.homeRate;
  const averageFor = home ? prediction?.leagueHomeRate : prediction?.leagueAwayRate;
  const averageAgainst = home ? prediction?.leagueAwayRate : prediction?.leagueHomeRate;
  const hasEstimate = [expectedFor, expectedAgainst].every(value => Number.isFinite(value) && value >= 0)
    && [averageFor, averageAgainst].every(value => Number.isFinite(value) && value > 0);
  return {
    round: fixture.round, opponent: teams.get(opponentId) ?? null, venue: home ? 'Casa' : 'Trasferta',
    attack: hasEstimate ? Math.max(0, 2 - expectedFor / averageFor) : null,
    defense: hasEstimate ? expectedAgainst / averageAgainst : null,
    expectedFor: hasEstimate ? expectedFor : null,
    expectedAgainst: hasEstimate ? expectedAgainst : null,
    currentMatches: hasEstimate ? prediction.currentMatches ?? null : null,
    priorMatches: hasEstimate ? prediction.priorMatches ?? null : null
  };
}

export function buildFixtureDifficulty({
  teams, fixtures, priorFixtures = [], rounds, asOf = new Date(), predict, calendarDay
}) {
  const timestamp = new Date(asOf).getTime();
  const selected = [...new Set(rounds.filter(Number.isInteger))].sort((a, b) => a - b).slice(0, 5);
  const selectedSet = new Set(selected);
  if (!Number.isFinite(timestamp) || !selected.length) return { rounds: [], rows: [] };
  const cutoff = calendarDay({ kickoff: new Date(timestamp).toISOString() });
  const beforeCutoff = fixture => {
    const day = calendarDay(fixture);
    return day && day < cutoff;
  };
  const history = fixtures.filter(fixture => fixture.status === 'played' && beforeCutoff(fixture));
  const prior = priorFixtures.filter(beforeCutoff);
  const byTeam = new Map(teams.map(team => [team.id, new Map()]));
  const teamsById = new Map(teams.map(team => [team.id, team]));

  for (const fixture of fixtures) {
    if (!selectedSet.has(fixture.round) || fixture.homeId === fixture.awayId) continue;
    const day = calendarDay(fixture);
    if (!canForecast(fixture, day, timestamp, cutoff)) continue;
    const prediction = day ? predict(fixture, history, prior) : null;
    for (const home of [true, false]) {
      const cells = byTeam.get(home ? fixture.homeId : fixture.awayId);
      if (!cells) continue;
      const cell = cells.has(fixture.round) ? null : cellFor(fixture, home, teamsById, prediction);
      cells.set(fixture.round, cell);
    }
  }
  return {
    rounds: selected,
    rows: [...teams].sort((a, b) => (a.shortName ?? a.name).localeCompare(b.shortName ?? b.name, 'it'))
      .map(team => ({ team, cells: selected.map(round => byTeam.get(team.id).get(round) ?? null) }))
  };
}

function level(value) {
  return value < 0.85 ? ['easy', 'Bassa'] : value > 1.15 ? ['hard', 'Alta'] : ['medium', 'Media'];
}

export function renderFixtureDifficulty(grid, { html, number, compact = false }) {
  if (!grid?.rounds.length || !grid.rows.length) return '';
  const title = compact ? 'Difficoltà dei prossimi incontri' : 'Difficoltà delle prossime giornate';
  const heading = compact ? `<h3>${title}</h3>` : `<h2>${title}</h2>`;
  const cell = matchup => {
    if (!matchup) return '<td>Partita non disponibile</td>';
    const opponent = matchup.opponent?.shortName ?? matchup.opponent?.name ?? 'Avversario non acquisito';
    const label = `<strong>${html(opponent)}</strong><br><small>${html(matchup.venue)}</small>`;
    if (matchup.attack === null) return `<td>${label}<br><small>Stima mancante</small></td>`;
    const [attackClass, attackLevel] = level(matchup.attack);
    const [defenseClass, defenseLevel] = level(matchup.defense);
    const sample = `${number(matchup.currentMatches)} gare correnti · ${number(matchup.priorMatches)} gare storiche`;
    return `<td>${label}<div class="fixture-difficulty-metrics" title="${html(sample)}">
      <span data-difficulty="${attackClass}">Att. ${attackLevel} <small>(${number(matchup.expectedFor, 2)})</small></span>
      <span data-difficulty="${defenseClass}">Dif. ${defenseLevel} <small>(${number(matchup.expectedAgainst, 2)})</small></span></div></td>`;
  };
  const firstEstimate = grid.rows.flatMap(row => row.cells).find(matchup => matchup?.attack != null);
  const sample = firstEstimate ? ` Campione di campionato · ${number(firstEstimate.currentMatches)} gare correnti e ${number(firstEstimate.priorMatches)} storiche.` : '';
  return `<section class="${compact ? 'dialog-section' : 'panel stacked'} fixture-difficulty">${heading}
    <p class="muted">Modello del Match Center. La difficoltà aumenta quando i gol attesi fatti scendono o quelli subiti salgono di oltre il 15% rispetto alla media di Serie A in casa o in trasferta. Tra parentesi, gol attesi fatti e subiti.${sample}</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="${title}"><table>
    <thead><tr><th scope="col">Squadra</th>${grid.rounds.map(round => `<th scope="col">G${round}</th>`).join('')}</tr></thead>
    <tbody>${grid.rows.map(({team, cells}) => `<tr><th scope="row">${html(team.shortName ?? team.name)}</th>${cells.map(cell).join('')}</tr>`).join('')}</tbody>
    </table></div></section>`;
}
