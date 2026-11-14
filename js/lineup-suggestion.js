const DEFAULT_METHODS = ['league-history', 'league-average', 'fantatb-history', 'events'];

function rankByPoints(first, second) {
  return second.points - first.points || String(first.player.id).localeCompare(String(second.player.id), 'it', { numeric: true });
}

function countSample(analysis) {
  return analysis.projection?.sample?.observations ?? analysis.teamGames;
}

function sampleRange(starters) {
  const values = starters.map(entry => entry.observations).filter(Number.isInteger);
  return {
    minimum: values.length ? Math.min(...values) : null,
    maximum: values.length ? Math.max(...values) : null,
    players: values.length
  };
}

export function suggestLineup(players, current, { formations, validate, analyze, methods = DEFAULT_METHODS }) {
  const roster = new Map(players.filter(player => player?.id != null).map(player => [player.id, player]));
  const modules = formations.map(formation => ({
    formation, required: Object.entries(validate([], formation).required)
  })).filter(({ required }) => required.reduce((total, [, count]) => total + count, 0) === 11);
  const empty = {
    lineup: null, method: null, expectedPoints: null, currentExpectedPoints: null, gain: null,
    eligible: 0, rosterCount: roster.size, comparedModules: 0, missingStarters: 11, sample: sampleRange([])
  };

  for (const method of methods) {
    const byPosition = new Map();
    const comparable = new Map();
    const eligible = [];
    for (const player of roster.values()) {
      const analysis = analyze(player, method);
      if (!analysis?.fixture || !Number.isFinite(analysis.expectedPoints)) continue;
      if (analysis.unavailable || analysis.projection?.method === 'confirmed-out') {
        comparable.set(player.id, 0);
        continue;
      }
      if (analysis.projection?.method !== method) continue;
      const entry = { player, points: analysis.expectedPoints, observations: countSample(analysis) };
      eligible.push(entry);
      comparable.set(player.id, entry.points);
      if (!byPosition.has(player.position)) byPosition.set(player.position, []);
      byPosition.get(player.position).push(entry);
    }
    for (const group of byPosition.values()) group.sort(rankByPoints);

    let best;
    let comparedModules = 0;
    let maxCovered = 0;
    for (const { formation, required } of modules) {
      const starters = required.flatMap(([position, count]) => (byPosition.get(position) ?? []).slice(0, count));
      maxCovered = Math.max(maxCovered, starters.length);
      if (!validate(starters.map(entry => entry.player), formation).valid) continue;
      comparedModules++;
      const points = starters.reduce((total, entry) => total + entry.points, 0);
      if (!best || points > best.points || (points === best.points && formation === current.formation)) {
        best = { formation, starters, points };
      }
    }
    if (!best) {
      if (11 - maxCovered < empty.missingStarters) {
        Object.assign(empty, { method, eligible: eligible.length, missingStarters: 11 - maxCovered });
      }
      continue;
    }

    const starters = best.starters.map(entry => entry.player.id);
    const chosen = new Set(starters);
    const reserves = eligible.filter(entry => !chosen.has(entry.player.id)).sort(rankByPoints).map(entry => entry.player.id);
    const currentPlayers = current.starters.map(id => roster.get(id));
    const currentCovered = validate(currentPlayers, current.formation).valid && current.starters.every(id => comparable.has(id));
    const currentExpectedPoints = currentCovered ? current.starters.reduce((total, id) => total + comparable.get(id), 0) : null;
    return {
      lineup: { formation: best.formation, starters, reserves, maxSubstitutions: current.maxSubstitutions },
      method, expectedPoints: best.points, currentExpectedPoints,
      gain: currentExpectedPoints === null ? null : best.points - currentExpectedPoints,
      eligible: eligible.length, rosterCount: roster.size, comparedModules, missingStarters: 0,
      sample: sampleRange(best.starters), reason: null
    };
  }

  return { ...empty, reason: 'Servono 11 giocatori utilizzabili con dati sufficienti e un metodo di stima comune.' };
}
