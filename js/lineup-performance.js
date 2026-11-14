const TRANSFERBEAT = new Set(['fantatb', 'transferbeat', 'transferbeat-ratings', 'storico fantatb']);

function sourceKey(id, name) {
  const value = String(id || name || '').trim().toLowerCase();
  return TRANSFERBEAT.has(value) ? 'fantatb' : value;
}

function lookup(player, kind, getVote, forecast) {
  const vote = getVote(player, forecast.round, forecast.season);
  const source = typeof vote?.source === 'string' ? vote.source.trim() : '';
  const key = sourceKey(vote?.sourceId, source);
  const recorded = Boolean(key) && (vote.fantasyRating === null || Number.isFinite(vote.fantasyRating));
  return {
    id: player.id, name: player.name, position: player.position, kind,
    expectedPoints: Number.isFinite(player.expectedPoints) ? player.expectedPoints : null,
    fantasyRating: recorded ? vote.fantasyRating : null, recorded,
    source: recorded ? source || key : null, sourceId: recorded ? key : null,
    use: kind === 'starter' ? 'unresolved' : 'bench', creditedPoints: null
  };
}

export function evaluateLineupPerformance(forecast, getVote) {
  const starters = forecast.starters.map(player => lookup(player, 'starter', getVote, forecast));
  const reserves = forecast.reserves.map(player => lookup(player, 'reserve', getVote, forecast));
  const rows = [...starters, ...reserves];
  const sources = new Map(rows.filter(row => row.recorded).map(row => [row.sourceId, row.source]));
  const expectedPoints = Number.isFinite(forecast.expectedPoints) ? forecast.expectedPoints : null;
  const expectedCoverage = Number.isFinite(forecast.coverage) ? forecast.coverage : null;
  const result = {
    rows, expectedPoints, expectedCoverage, method: forecast.method ?? null, expectedSource: forecast.source ?? null,
    actualPoints: null, observedPoints: null, difference: null, coverage: { known: 0, total: starters.length },
    source: null, sourceId: null, substitutions: 0, reason: null
  };
  if (sources.size > 1) return { ...result, reason: 'I fantavoti provengono da fonti diverse.' };
  if (!sources.size) return { ...result, reason: 'Nessun fantavoto acquisito per questa formazione.' };

  const [[actualSourceId, actualSource]] = sources;
  const vacancies = new Map();
  const uncertainReserves = new Map();
  const unknownStarter = starters.some(row => !row.recorded);
  let blocked = unknownStarter;
  const limit = Number.isInteger(forecast.maxSubstitutions) ? Math.max(0, forecast.maxSubstitutions) : 0;

  for (const row of starters) {
    if (Number.isFinite(row.fantasyRating)) {
      row.use = 'starter';
      row.creditedPoints = row.fantasyRating;
    } else if (row.recorded) {
      const slots = vacancies.get(row.position) ?? [];
      slots.push(row);
      vacancies.set(row.position, slots);
    }
  }
  for (const row of reserves) {
    const slots = vacancies.get(row.position);
    if (!slots?.length || result.substitutions >= limit || (row.recorded && row.fantasyRating === null)) continue;
    if (!row.recorded) blocked = true;
    if (blocked) {
      row.use = 'unresolved';
      uncertainReserves.set(row.position, (uncertainReserves.get(row.position) ?? 0) + 1);
      continue;
    }
    const replaced = slots.shift();
    replaced.use = 'no-vote';
    replaced.replacementId = row.id;
    row.use = 'substitute';
    row.creditedPoints = row.fantasyRating;
    result.substitutions++;
  }
  for (const [position, slots] of vacancies) {
    const uncertain = Math.min(uncertainReserves.get(position) ?? 0, limit - result.substitutions);
    slots.slice(uncertain).forEach(row => { row.use = 'no-vote'; });
  }

  const known = starters.filter(row => row.use !== 'unresolved').length;
  const observed = rows.filter(row => Number.isFinite(row.creditedPoints));
  const observedPoints = known || observed.length ? observed.reduce((total, row) => total + row.creditedPoints, 0) : null;
  const actualPoints = starters.length > 0 && known === starters.length ? observedPoints : null;
  const expectedSourceId = sourceKey(forecast.sourceId, forecast.source) || (forecast.method === 'fantatb-history' ? 'fantatb' : '');
  const completeForecast = expectedCoverage === 1 && forecast.complete !== false;
  const canCompare = actualPoints !== null && expectedPoints !== null && completeForecast
    && actualSourceId === expectedSourceId;

  return {
    ...result, source: actualSource, sourceId: actualSourceId, observedPoints, actualPoints,
    coverage: { known, total: starters.length }, difference: canCompare ? actualPoints - expectedPoints : null,
    reason: actualPoints === null ? 'Mancano fantavoti o informazioni per determinare tutte le sostituzioni.'
      : expectedPoints === null ? 'Manca una previsione salvata.'
      : !completeForecast ? 'La previsione salvata aveva copertura parziale.'
      : !canCompare ? 'La previsione e i fantavoti acquisiti usano basi di punteggio diverse.'
      : null
  };
}
