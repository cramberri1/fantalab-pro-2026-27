export function renderPanoramica({
  dataset, round, getRoundWindow, groupPlayers, modeState, iconSpan, metric, number, roundPreview,
  coverageRows
}) {
  const calendar = getRoundWindow(dataset);
  const isNext = calendar.next === round;
  const isLatest = calendar.latest === round;
  const nextTitle = calendar.nextStarted ? 'Giornata in corso' : 'Prossima giornata';
  const recentTitle = calendar.latestComplete ? 'Ultima giornata giocata' : 'Ultima giornata con risultati';
  const recentNote = calendar.latestComplete ? '' : ' · risultati parziali';
  const selectedTitle = isNext ? nextTitle : isLatest ? recentTitle : 'Giornata selezionata';
  const finalCount = dataset.fixtures.filter(f => f.status === 'played').length;
  const ready = dataset.players.filter(p => p.ratings?.some(vote => Number.isFinite(vote.fantasyRating))
    || Number.isFinite(p.minutes) && Number.isFinite(p.appearances)).length;
  const rosterCount = groupPlayers(modeState().roster).length;
  return `<section class="hero" aria-labelledby="overview-title">
    <div class="hero-image" aria-hidden="true"></div><div class="eyebrow">Serie A 2026/27 · Giornata ${round}</div>
    <h1 id="overview-title">FantaLab Pro</h1>
    <p>Analizza gli incroci della giornata, consulta le statistiche e prepara la tua formazione.</p>
    <div class="hero-actions"><a class="btn primary" href="#match">Apri Match Center ${iconSpan('arrow')}</a><a class="btn" href="#rosa">Vai alla rosa</a></div>
  </section>
  <section class="metrics" aria-label="Stato della stagione">
    ${metric('Risultati acquisiti', `${number(finalCount)}<small> / ${number(dataset.fixtures.length)}</small>`, 'Partite con risultato finale', 'pitch')}
    ${metric('Calciatori nel listone', number(dataset.players.length), `${number(ready)} con fantavoti o dati di gioco`, 'users')}
    ${metric('La tua rosa', number(rosterCount), 'Calciatori salvati in questa modalità', 'shirt')}
  </section>
  <div class="split overview-rounds">
    ${roundPreview(round, selectedTitle, isLatest ? recentNote : '')}
    ${calendar.latest != null && !isLatest ? roundPreview(calendar.latest, recentTitle, recentNote)
      : calendar.next != null && !isNext ? roundPreview(calendar.next, nextTitle) : ''}
  </div>
  <section class="panel overview-coverage"><div class="panel-head"><h2>Copertura dati</h2><a class="text-link" href="#fonti">Vedi fonti →</a></div>${coverageRows(['fixtures','results','players','ratings','teamExpectedGoals','expectedGoals','expectedAssists','absences'])}</section>`;
}
