export function compareLineups(reference, current, simulate) {
  const maxSubstitutions = current.maxSubstitutions;
  // The order of starters has no tactical effect. Use a stable order for seeded draws.
  const setup = record => ({
    ...record,
    starters: [...record.starters].sort(),
    reserves: maxSubstitutions === 0 ? [] : record.reserves,
    maxSubstitutions
  });
  const referenceSetup = setup(reference);
  const currentSetup = setup(current);
  const referenceResult = simulate(referenceSetup);
  const sameLineup = referenceSetup.formation === currentSetup.formation
    && ['starters', 'reserves'].every(key => referenceSetup[key].length === currentSetup[key].length
      && referenceSetup[key].every((id, index) => id === currentSetup[key][index]));
  const currentResult = sameLineup ? referenceResult : simulate(currentSetup);

  const complete = (record, result) => result.status === 'simulated' && result.coverage === 1
    && result.individual.filter(player => player.role === 'starter').length === record.starters.length
    && result.individual.filter(player => player.role === 'reserve').length === record.reserves.length;
  const hasEstimates = [referenceResult, currentResult].every(result => Number.isFinite(result.mean));
  const fullCoverage = complete(referenceSetup, referenceResult) && complete(currentSetup, currentResult);
  const sameMethod = Boolean(referenceResult.method) && referenceResult.method === currentResult.method;
  return {
    referenceResult,
    currentResult,
    maxSubstitutions,
    difference: hasEstimates && fullCoverage && sameMethod ? currentResult.mean - referenceResult.mean : null,
    explanation: !hasEstimates ? 'Serve una stima per entrambe le formazioni.'
      : !fullCoverage ? 'Per calcolare la differenza servono dati per tutti i titolari e le riserve.'
      : !sameMethod ? 'Per calcolare la differenza serve lo stesso metodo di stima.'
      : ''
  };
}

export function renderLineupComparison({
  reference, result, html, number, percent, projectionLabel, canSave = true, canCompare = true
}) {
  const row = (label, simulation) => {
    const hasEstimate = Number.isFinite(simulation.mean);
    const omitted = simulation.excluded.length;
    return `<tr><th scope="row">${label}</th>
      <td>${hasEstimate ? html(projectionLabel(simulation.method)) : 'Stima non disponibile'}
        ${omitted ? `<br><small>${number(omitted)} esclusi</small>` : ''}</td>
      <td class="numeric">${hasEstimate ? percent(simulation.coverage) : '—'}</td>
      <td class="numeric">${number(simulation.mean, 2)}</td>
      <td class="numeric">${hasEstimate ? `${number(simulation.p10, 1)} – ${number(simulation.p90, 1)}` : '—'}</td></tr>`;
  };
  return `<section class="panel lineup-comparison" data-lineup-comparison aria-labelledby="lineup-comparison-title">
    <div class="panel-head"><div><h2 id="lineup-comparison-title">Confronto formazioni</h2>
      <p>${reference ? `Riferimento salvato · ${html(reference.formation)} · ${number(reference.reserves.length)} riserve`
        : 'Salva la formazione attuale come riferimento, poi prova una variante nella stessa giornata.'}</p></div></div>
    <div class="actions">
      <button type="button" data-lineup-reference="save" ${canSave ? '' : 'disabled'}>${reference ? 'Aggiorna riferimento' : 'Salva come riferimento'}</button>
      ${reference ? `<button type="button" data-lineup-reference="restore">Ripristina riferimento</button>
        <button type="button" data-lineup-compare ${canCompare ? '' : 'disabled'}>Simula il confronto</button>` : ''}
    </div>
    ${!canSave || (reference && !canCompare) ? '<p class="inline-status">Completa la formazione attuale con 11 titolari compatibili con il modulo.</p>' : ''}
    <div aria-live="polite">
      ${result ? `<div class="table-wrap" tabindex="0" role="region" aria-label="Risultati del confronto tra formazioni">
        <table><thead><tr><th>Formazione</th><th>Metodo</th><th class="numeric">Copertura titolari</th>
          <th class="numeric">Fantapunti medi</th><th class="numeric">Intervallo P10–P90</th></tr></thead>
        <tbody>${row('Riferimento', result.referenceResult)}${row('Attuale', result.currentResult)}</tbody></table>
      </div>
      ${result.difference === null ? `<p class="inline-status">${html(result.explanation)}</p>`
        : `<p class="inline-status"><strong>Differenza media (attuale − riferimento) · ${result.difference >= 0 ? '+' : ''}${number(result.difference, 2)} fantapunti</strong></p>`}
      <p class="inline-status">Stessi dati, scenari, seed e limite cambi (${number(result.maxSubstitutions)}). Gli intervalli mostrano l’80% centrale degli scenari di ogni formazione.</p>` : ''}
    </div>
  </section>`;
}
