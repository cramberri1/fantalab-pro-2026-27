export function renderMatch({
  dataset, round, selectedFixtureId, byRound, rounds, getRoundWindow, heading, fixtureList, matchCard,
  renderFixtureDifficulty, difficultyGrid, html, number
}) {
  const fixtures = byRound();
  const current = fixtures.find(f => f.id === selectedFixtureId) ?? fixtures[0];
  const allRounds = rounds();
  const index = allRounds.indexOf(round);
  const calendar = getRoundWindow(dataset);
  const shortcuts = [
    [calendar.next, calendar.nextStarted ? 'Giornata in corso' : 'Prossima giornata'],
    [calendar.latest, calendar.latestComplete ? 'Ultima giornata giocata' : 'Ultima giornata con risultati']
  ].filter(([day]) => day != null);
  return `${heading('Match Center', 'Calendario, risultati, rendimento recente e difficoltà per reparto.')}
    ${shortcuts.length ? `<div class="actions calendar-shortcuts" role="group" aria-label="Scorciatoie giornate">
      ${shortcuts.map(([day, label]) => `<button type="button" data-round="${day}" aria-pressed="${round === day}">${label} · G${day}</button>`).join('')}
    </div>` : ''}
    <div class="split">
      <section class="panel"><div class="panel-head"><div><h2>Giornata ${round}</h2><p>Orari italiani quando disponibili</p></div><div class="actions"><button data-round="${allRounds[index - 1] ?? ''}" aria-label="Giornata precedente" ${index <= 0 ? 'disabled' : ''}>←</button>
        <button data-round="${allRounds[index + 1] ?? ''}" aria-label="Giornata successiva" ${index === allRounds.length - 1 ? 'disabled' : ''}>→</button></div></div>${fixtureList(fixtures, current?.id)}</section>
      <section class="panel" id="match-detail" aria-label="Dettaglio incontro">${matchCard(current)}</section>
    </div><div id="fixture-difficulty">${renderFixtureDifficulty(difficultyGrid(), { html, number })}</div>`;
}
