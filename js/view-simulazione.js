export function renderSimulazione({
  lineup, groupPlayers, validateLineup, playerAnalysis, heading, html, mode, marketImports,
  simulationResult, number, lineupUndo, round, dataset, lineupSimulationOutput, lineupComparisonPanel,
  scoringPanel
}) {
  const record = lineup();
  const starters = groupPlayers(record.starters);
  const validation = validateLineup(starters, record.formation);
  const ready = starters.filter(player => Number.isFinite(playerAnalysis(player).expectedPoints)).length;
  return `${heading('Simulazione', 'Esplora come presenze, bonus e sostituzioni cambiano la distribuzione dei fantapunti.')}
  <div class="split"><section class="panel"><div class="panel-head"><div><h2>Monte Carlo</h2><p>${html(record.formation)} · ${starters.length}/11 titolari · ${record.reserves.length} riserve</p></div></div>
    ${!validation.valid ? `<p class="notice neutral">Imposta 11 titolari compatibili con il modulo. <a href="#rosa" class="text-link">Vai alla rosa →</a></p>` : ''}
    ${mode === 'real' && starters.length ? `<p class="inline-status">${ready} titolari con una stima su ${starters.length}.${ready < starters.length ? ' Lo storico FantaTB può essere integrato con l’Excel della tua lega.' : ''}</p>` : ''}
    ${mode === 'real' && !marketImports.listone?.asOfRound ? '<p class="inline-status"><a class="text-link" href="#mercato">Carica il listone e indica fino a quale giornata è aggiornato</a> per usare fantamedia e partite a voto della lega.</p>' : ''}
    <form id="simulation-form"><div class="form-fields">
      <label class="field-label">Scenari<select name="iterations">${[1000,5000,10000,30000].map(n => `<option value="${n}" ${n === (simulationResult?.iterations || 5000) ? 'selected' : ''}>${number(n)}</option>`).join('')}</select></label>
      <label class="field-label">Seed<input type="number" name="seed" value="${html(simulationResult?.seed ?? 202627)}" min="0" max="4294967295" required></label></div>
      <button class="primary" type="submit" ${validation.valid ? '' : 'disabled'}>Avvia simulazione</button>
    </form>
    <p class="inline-status">Stesso seed, stessi dati e stessa formazione producono lo stesso risultato. <a class="text-link" href="#fonti">Regole del modello</a></p>
    ${lineupUndo[mode].has(round) ? '<button type="button" data-lineup-undo>Annulla ultima modifica</button>' : ''}
    ${mode === 'demo' && dataset.demoPreset ? '<button data-load-preset>Carica rosa demo</button>' : ''}
  </section><section class="panel" id="simulation-output" aria-live="polite">${lineupSimulationOutput()}</section></div>
    ${lineupComparisonPanel()}
  ${scoringPanel()}`;
}
