export function renderRendimento({
  modeState, heading, votesByPlayer, officialArchive, evaluateLineupPerformance, mode, realizedVote,
  html, projectionLabel, date, percent, stat, number
}) {
  const records = Object.values(modeState().forecasts).sort((a,b) => b.round - a.round);
  return `${heading('Rendimento della rosa', 'Confronta le previsioni salvate prima della giornata con i fantavoti acquisiti.')}
    ${records.length ? records.map(forecast => {
      const local = forecast.method === 'league-history' || (forecast.method !== 'fantatb-history' && forecast.starters.some(player =>
        votesByPlayer.get(player.id)?.rows.some(row => row.round === forecast.round && row.season === forecast.season)));
      const useOfficial = forecast.method === 'official-history' || (!['league-history','fantatb-history'].includes(forecast.method) &&
        officialArchive.days.some(day => day.season === forecast.season && day.round === forecast.round));
      const basis = useOfficial ? 'official' : local ? 'csv' : 'fantatb';
      const result = evaluateLineupPerformance(forecast, (player, day, season) => mode === 'real' ? realizedVote(player, day, season, basis) : undefined);
      return `<section class="panel stacked"><h2>Giornata ${forecast.round}</h2>
        <p>${html(projectionLabel(result.method))} · ${html(date(forecast.asOf))} · copertura previsione ${percent(result.expectedCoverage)}.</p>
        <div class="detail-grid">${stat('Fantapunti attesi',number(result.expectedPoints,2))}${stat('Fantapunti dai voti',number(result.actualPoints,2))}
        ${stat('Scarto reale − attesi',number(result.difference,2))}${stat('Posti verificati',`${result.coverage.known}/${result.coverage.total}`)}</div>
        <p class="muted">${result.source ? `Fonte voti · ${html(result.source)}. ` : ''}${html(result.reason)}</p>
        <details><summary>Rendimento dei calciatori</summary><div class="table-wrap" tabindex="0" role="region" aria-label="Rendimento individuale G${forecast.round}">
        <table><thead><tr><th>Calciatore</th><th>Attesi accreditati</th><th>Fantavoto</th><th>Punti accreditati</th></tr></thead><tbody>
        ${result.rows.map(row => `<tr><th scope="row">${html(row.name)}<br><small>${row.kind === 'starter' ? 'Titolare' : 'Riserva'}</small></th>
          <td>${number(row.expectedPoints,2)}</td><td>${row.recorded && row.fantasyRating === null ? 'SV' : number(row.fantasyRating,2)}</td><td>${number(row.creditedPoints,2)}</td></tr>`).join('')}
        </tbody></table></div></details></section>`;
    }).join('') : '<section class="panel"><p>Salva una previsione in Simulazione prima che cominci la giornata.</p><a class="btn" href="#simulazione">Apri simulazione</a></section>'}`;
}
