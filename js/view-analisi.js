export function renderAnalisi({
  mode, heading, dataset, historicalArchive, analysisTeamId, empty, getTeam, teamSeasonRows,
  matchValidation, metric, number, html, historicalError, seasonTable, sourceLink, byGame,
  officialVotesPanel, votesPanel
}) {
  const description = 'Confronta le prestazioni delle squadre con la stagione precedente e verifica la copertura dei dati individuali.';
  if (mode === 'demo') return `${heading('Analisi',description)}<section class="panel">
    <p>L’archivio delle stagioni di Serie A è disponibile in Dati reali.</p><button data-mode="real">Passa ai dati reali</button></section>`;
  const options = [...new Map([...dataset.teams,...(historicalArchive?.teams ?? [])].map(team => [team.id,team])).values()]
    .sort((a,b) => a.shortName.localeCompare(b.shortName,'it'));
  const team = options.find(item => item.id === analysisTeamId) ?? options[0];
  if (!team) return `${heading('Analisi',description)}${empty('Squadre non disponibili.')}`;
  const currentTeam = getTeam(team.id);
  const current = currentTeam ? teamSeasonRows(team.id,dataset.fixtures) : null;
  const historic = historicalArchive?.teamMap.has(team.id) ? teamSeasonRows(team.id,historicalArchive.fixtures,true) : null;
  const xg = currentTeam?.stats?.xg;
  const xgMatches = currentTeam?.stats?.xgMatches;
  const goals = current?.totals.scored;
  const totalMatches = current?.totals.games;
  const coveredFixtures = dataset.fixtures.filter(row => row.status === 'played').length;
  const playersWithVotes = dataset.players.filter(p => p.ratings?.some(r => Number.isFinite(r.fantasyRating))).length;
  const sample = Number.isFinite(xg) && Number.isFinite(xgMatches);
  const validation = matchValidation();
  const calibration = validation?.goalCalibration;
  return `${heading('Analisi',description)}
    <div class="metrics" aria-label="Copertura dell’analisi">
      ${metric('Risultati 2026/27',number(coveredFixtures),'Partite concluse acquisite','pitch')}
      ${metric('Risultati 2025/26',number(historicalArchive?.fixtures.length),'Archivio storico di Serie A','calendar')}
      ${metric('Giocatori con fantavoti',number(playersWithVotes),'Serie 2026/27 FantaTB','users')}
    </div>
    <div class="split">
      <section class="panel"><div class="panel-head"><div><h2>Analisi squadre</h2><p>Confronto per partita e per campo</p></div>
        <label class="field-label">Squadra<select id="analysis-team">${options.map(item =>
          `<option value="${html(item.id)}" ${item.id === team.id ? 'selected' : ''}>${html(item.shortName)}</option>`).join('')}</select></label></div>
        ${historicalError ? '<p class="notice neutral">L’archivio della stagione precedente non è raggiungibile.</p>' : !historicalArchive ? '<p class="muted">Caricamento dello storico…</p>' : ''}
        ${seasonTable(current,historic)}
        ${sample ? `<div class="duel"><h3>Produzione offensiva attesa · 2026/27</h3><p>${number(xg,2)} xG misurati in ${number(xgMatches)} partite · ${number(byGame(xg,xgMatches),2)} xG/partita. ${sourceLink(currentTeam.stats.xgSource)}</p>
        ${Number.isFinite(goals) && totalMatches > 0 ? `<p>Gol fatti nell’archivio dei risultati · ${number(goals)} su ${number(totalMatches)} partite. La differenza gol − xG richiede campioni verificati partita per partita.</p>` : ''}</div>` : ''}
      </section>
      <section class="panel prose"><h2>Analisi calciatori</h2>
        <p>Le schede mostrano il rendimento osservato e la fonte del fantapunteggio atteso.</p>
        <div class="actions"><a class="btn primary" href="#giocatori">Apri le schede</a><a class="btn" href="#simulazione">Simula la formazione</a></div>
        <h3>Metodo e fonti</h3><p>Usa le medie su campioni confrontabili e verifica la provenienza di xG, assist attesi e fantavoti.</p>
        <a class="text-link" href="#fonti">Copertura e fonti →</a>
        <p><a href="https://github.com/cramberri1/fantalab-pro-2026-27/blob/main/docs/ANALISI.md" target="_blank" rel="noopener noreferrer">Scheda delle fonti per player e match analysis</a></p>
      </section>
    </div>
    ${officialVotesPanel()}
    <div class="split overview-rounds">${votesPanel()}
      <section class="panel"><h2>Verifica retrospettiva 1X2</h2>
        ${validation?.matches ? `<p>${number(validation.matches)} partite 2026/27. Per ogni partita il modello usa soltanto risultati dei giorni precedenti. Il riferimento usa le medie casa e trasferta di Serie A.</p>
        <p>La replica applica a ogni partita il metodo e la taratura che FantaLab avrebbe scelto prima del calcio d’inizio.</p>
        <div class="table-wrap"><table><thead><tr><th>Metodo</th><th>Brier</th><th>Log loss</th></tr></thead><tbody>
        ${[['Poisson campionato',validation.baseline],['Poisson per squadra',validation.model],['Dixon–Coles',validation.dixonColes],['Replica senza taratura gol',calibration?.unscaledReplay],['Replica della scelta prepartita',validation.replay]].map(([label, scores]) =>
          `<tr><th scope="row">${label}</th><td>${number(scores?.brier,4)}</td><td>${number(scores?.logLoss,4)}</td></tr>`).join('')}</tbody></table></div>
        <p>Modello attuale · ${validation.selectedModel === 'dixon-coles' ? 'Dixon–Coles' : 'Poisson per squadra'}. Dixon–Coles si attiva dopo almeno 50 gare di confronto, se migliora entrambi i punteggi.</p>
        ${calibration ? `<p>Taratura gol ${calibration.applied ? `attiva · fattore ${number(calibration.multiplier,3)}` : 'in verifica'} · ${number(calibration.evaluatedMatches)} partite di confronto.</p>
          ${calibration.evaluatedMatches ? `<p>Devianza del totale gol sullo stesso campione · ${number(calibration.fixed.goalDeviance,3)} senza taratura · ${number(calibration.adaptive.goalDeviance,3)} con taratura. Valori più bassi indicano meno errore.</p>` : ''}` : ''}`
        : '<p>Verifica disponibile con l’archivio della stagione precedente e risultati acquisiti.</p>'}</section>
    </div>`;
}
