const POSITIONS = ['GK', 'DEF', 'MID', 'FWD'];
const POSITION_LABELS = { GK: 'portieri', DEF: 'difensori', MID: 'centrocampisti', FWD: 'attaccanti' };
export const FORMATION_OPTIONS = ['3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-3-2', '5-4-1'];
export const SCORING = Object.freeze({ appearance: 6, goal: 3, assist: 1, yellowCard: -0.5, goalkeeperConceded: -1 });

const COMPLETED = new Set(['finished', 'played', 'ft', 'aet', 'pen', 'awarded']);
const PENDING = new Set(['scheduled', 'timed', 'upcoming', 'tbd', 'ns', 'not started']);
const RULED_OUT = new Set(['out', 'injured', 'suspended', 'unavailable', 'ruled_out', 'ruled out']);
const QUESTIONABLE = new Set(['doubtful', 'questionable', 'doubt', 'probable', 'uncertain']);
const CONFIRMED = new Set(['available', 'fit', 'cleared']);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const present = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const statusKey = (value) => String(value ?? '').trim().toLowerCase();
const sameId = (left, right) => left != null && right != null && String(left) === String(right);
const sum = (items) => items.reduce((total, value) => total + value, 0);
const average = (items) => sum(items) / items.length;

export function validateLineup(players, formation) {
  const counts = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  const errors = [];
  const missing = {};
  const ids = new Set();

  for (const player of players) {
    if (player?.id == null || !POSITIONS.includes(player.position)) {
      errors.push('Giocatore senza identificativo o ruolo.');
      continue;
    }
    if (ids.has(String(player.id))) {
      errors.push(`${player.name} è presente più volte.`);
      continue;
    }
    ids.add(String(player.id));
    counts[player.position] += 1;
  }

  if (!FORMATION_OPTIONS.includes(formation)) {
    errors.push('Seleziona un modulo supportato.');
    return { valid: false, counts, required: {}, errors, missing };
  }

  const [defenders, midfielders, forwards] = formation.split('-').map(Number);
  const required = { GK: 1, DEF: defenders, MID: midfielders, FWD: forwards };
  for (const position of POSITIONS) {
    const difference = required[position] - counts[position];
    missing[position] = Math.max(0, difference);
    if (difference > 0) errors.push(`Da aggiungere ${difference} ${POSITION_LABELS[position]}.`);
    if (difference < 0) errors.push(`Da togliere ${-difference} ${POSITION_LABELS[position]}.`);
  }
  return { valid: errors.length === 0, counts, required, errors, missing };
}

function hasTeam(fixture, teamId) {
  return sameId(fixture.homeId, teamId) || sameId(fixture.awayId, teamId);
}

function fixtureTime(fixture) {
  return Date.parse(fixture.kickoff ?? fixture.date ?? '');
}

function byKickoff(first, second) {
  const firstTime = fixtureTime(first) || Number.MAX_SAFE_INTEGER;
  const secondTime = fixtureTime(second) || Number.MAX_SAFE_INTEGER;
  return firstTime - secondTime || Number(first.round) - Number(second.round);
}

export function getPlayerFixture(player, fixtures = [], round) {
  const matches = fixtures.filter((fixture) => hasTeam(fixture, player?.teamId));
  if (round != null && round !== '') {
    return matches.filter((fixture) => sameId(fixture.round, round)).sort(byKickoff)[0] ?? null;
  }
  return matches.filter((fixture) => PENDING.has(statusKey(fixture.status))).sort(byKickoff)[0] ?? null;
}

function finishedBefore(fixture, target) {
  if (!COMPLETED.has(statusKey(fixture.status))) return false;
  if (!target) return true;
  if (sameId(fixture.id, target.id)) return false;
  const playedTime = fixtureTime(fixture);
  const targetTime = fixtureTime(target);
  if (Number.isFinite(playedTime) && Number.isFinite(targetTime)) return playedTime < targetTime;
  return Number(fixture.round) < Number(target.round);
}

function sideResults(fixtures, teamId) {
  return fixtures.filter((fixture) => hasTeam(fixture, teamId)).sort(byKickoff).slice(-5).map((fixture) => {
    if (sameId(fixture.homeId, teamId)) return { scored: fixture.homeGoals, conceded: fixture.awayGoals };
    return { scored: fixture.awayGoals, conceded: fixture.homeGoals };
  });
}

function fixtureProjection(player, fixture, completed) {
  const scored = completed.filter((match) => present(match.homeGoals) && present(match.awayGoals));
  const result = { matchFactor: null, attackFactor: null, concededRate: null, opponentMatches: 0 };
  if (!fixture || scored.length < 12) return result;

  const opponentId = sameId(fixture.homeId, player.teamId) ? fixture.awayId : fixture.homeId;
  const opponents = sideResults(scored, opponentId);
  if (opponents.length < 4) return result;
  const leagueMean = average(scored.map((match) => (match.homeGoals + match.awayGoals) / 2));
  if (leagueMean <= 0) return result;

  const opponentConceded = average(opponents.map((match) => match.conceded));
  result.attackFactor = clamp(1 + 0.35 * (opponentConceded / leagueMean - 1), 0.8, 1.2);
  result.matchFactor = result.attackFactor;
  result.opponentMatches = opponents.length;

  if (player.position === 'GK') {
    const opponentScored = average(opponents.map((match) => match.scored));
    result.matchFactor = clamp(1 + 0.35 * (1 - opponentScored / leagueMean), 0.8, 1.2);
    const ownMatches = sideResults(scored, player.teamId);
    if (ownMatches.length >= 4) {
      const teamConceded = average(ownMatches.map((match) => match.conceded));
      result.concededRate = (teamConceded + opponentScored) / 2;
    }
  }
  return result;
}

function getAvailability(player, fixture, absences) {
  const report = fixture && absences.find((item) => sameId(item.playerId, player.id) && sameId(item.fixtureId, fixture.id));
  const reported = statusKey(report?.status);
  if (RULED_OUT.has(reported)) return { status: 'out', reason: report.reason || report.status, multiplier: 0 };
  if (QUESTIONABLE.has(reported)) return { status: 'doubtful', reason: report.reason || report.status, multiplier: 0.75 };
  if (CONFIRMED.has(reported)) return { status: 'available', reason: report.reason || report.status, multiplier: 1 };
  if (reported) return { status: 'reported', reason: report.reason || report.status, multiplier: 1, fixtureSpecific: true };

  const seasonStatus = statusKey(player.injuryStatus);
  const seasonReport = RULED_OUT.has(seasonStatus) || QUESTIONABLE.has(seasonStatus) || seasonStatus === 'reported';
  if (seasonReport) return { status: 'reported', reason: player.injuryReason || player.injuryStatus, multiplier: 1 };
  return { status: 'unknown', reason: null, multiplier: 1 };
}

function playingTime(player, teamGames, availability) {
  const { appearances, starts } = player;
  if (!teamGames || !present(appearances) || !present(player.minutes) || appearances > teamGames) {
    return null;
  }
  if (!appearances) {
    return { appearanceProbability: 0, startProbability: 0, expectedMinutes: 0, profiles: [] };
  }
  if (!player.minutes) return null;

  const minutes = Math.min(player.minutes, appearances * 90);
  const appearanceProbability = availability.multiplier * appearances / teamGames;
  const typicalMinutes = minutes / appearances;
  if (!present(starts) || starts > appearances) {
    return {
      appearanceProbability,
      startProbability: null,
      expectedMinutes: appearanceProbability * typicalMinutes,
      profiles: [{ probability: appearanceProbability, minutes: typicalMinutes }],
    };
  }

  const substitutes = appearances - starts;
  const startProbability = availability.multiplier * starts / teamGames;
  const substituteProbability = appearanceProbability - startProbability;
  const profiles = [];
  if (starts && substitutes) {
    const minimumSubMinutes = Math.max(0, (minutes - 90 * starts) / substitutes);
    const subMinutes = clamp(typicalMinutes / 2, minimumSubMinutes, typicalMinutes);
    const startMinutes = (minutes - subMinutes * substitutes) / starts;
    profiles.push({ probability: startProbability, minutes: startMinutes }, { probability: substituteProbability, minutes: subMinutes });
  } else {
    profiles.push({ probability: appearanceProbability, minutes: typicalMinutes });
  }
  return { appearanceProbability, startProbability, expectedMinutes: appearanceProbability * typicalMinutes, profiles };
}

function per90(observed, expected, minutes) {
  if (!present(minutes) || !minutes) return { value: null, source: 'missing' };
  if (present(observed) && present(expected)) {
    return { value: (0.35 * observed + 0.65 * expected) * 90 / minutes, source: 'blend' };
  }
  if (present(expected)) return { value: expected * 90 / minutes, source: 'expected' };
  if (present(observed)) return { value: observed * 90 / minutes, source: 'observed' };
  return { value: null, source: 'missing' };
}

function yellowProbability(rate, minutes) {
  return rate == null ? 0 : 1 - Math.exp(-rate * minutes / 90);
}

function expectedScore(projection) {
  if (projection.appearanceProbability === 0) return 0;
  if (projection.goalRate == null || projection.assistRate == null) return null;

  const bonusPer90 = SCORING.goal * projection.goalRate + SCORING.assist * projection.assistRate;
  const concededPenalty = SCORING.goalkeeperConceded * (projection.concededRate ?? 0);
  return sum(projection.profiles.map((profile) => {
    const yellowPenalty = SCORING.yellowCard * yellowProbability(projection.yellowRate, profile.minutes);
    return profile.probability * (SCORING.appearance + profile.minutes / 90 * (bonusPer90 + concededPenalty) + yellowPenalty);
  }));
}

function indexComponents(projection, teamGames, position) {
  const { appearanceProbability, expectedMinutes, goalRate, assistRate, matchFactor, opponentMatches } = projection;
  const attackBonus = goalRate == null || assistRate == null ? null : (SCORING.goal * goalRate + SCORING.assist * assistRate);
  const opponentGoalDetail = position === 'GK' ? 'Gol segnati dall’avversario' : 'Gol subiti dall’avversario';
  const values = [
    { id: 'appearance', label: 'Probabilità di impiego', value: appearanceProbability * 100, weight: 40, detail: `Presenze sulle ${teamGames} gare concluse dalla squadra, con eventuale correzione per i dubbi di giornata.` },
    { id: 'minutes', label: 'Minuti attesi', value: expectedMinutes / 90 * 100, weight: 25, detail: 'Minuti attesi a partita in percentuale di 90, considerando anche il rischio di assenza.' },
    { id: 'attack', label: 'Potenziale bonus', value: attackBonus == null ? null : clamp(attackBonus / 2.5 * 100, 0, 100), weight: 25, detail: 'Punti per gol e assist stimati per 90 minuti. Il componente raggiunge 100 a 2,5 punti bonus per 90.' },
    { id: 'matchup', label: 'Avversario', value: matchFactor == null ? null : Number(appearanceProbability > 0) * clamp((matchFactor - 0.8) * 250, 0, 100), weight: 10, detail: `${opponentGoalDetail} nelle ultime ${opponentMatches || 4} gare utili, rapportati alla media di Serie A. Il contributo vale zero se non è previsto impiego.` },
  ];
  const availableWeight = sum(values.filter((component) => component.value != null).map((component) => component.weight));
  const components = values.map((component) => {
    const effectiveWeight = component.value == null ? 0 : component.weight / availableWeight * 100;
    return { ...component, effectiveWeight, contribution: component.value == null ? null : component.value * effectiveWeight / 100 };
  });
  return { components, coverage: availableWeight / 100, index: Math.round(sum(components.map((component) => component.contribution ?? 0))) };
}

export function analyzePlayer(player, options = {}) {
  const { dataset, round, mode = dataset?.mode } = options;
  const record = dataset?.players?.find((item) => sameId(item.id, player?.id));
  const base = {
    mode,
    index: null,
    components: [],
    coverage: 0,
    expectedPoints: null,
    projection: null,
    unavailable: false,
    availability: null,
    fixture: null,
    teamGames: null,
    notes: [],
    status: 'insufficient',
  };
  if (!['demo', 'real'].includes(mode) || dataset?.mode !== mode || !record) {
    return { ...base, notes: ['Giocatore assente dall’archivio selezionato.'] };
  }

  const fixtures = dataset.fixtures ?? [];
  const fixture = options.fixture === undefined
    ? getPlayerFixture(record, fixtures, round)
    : fixtures.find((match) => sameId(match.id, options.fixture?.id) && hasTeam(match, record.teamId)) ?? null;
  const availability = getAvailability(record, fixture, dataset.absences ?? []);
  const result = { ...base, fixture, availability };
  if (fixture && !PENDING.has(statusKey(fixture.status))) {
    const status = COMPLETED.has(statusKey(fixture.status)) ? 'historical' : 'insufficient';
    return { ...result, status, notes: ['Proiezione disponibile per le partite da giocare.'] };
  }

  if (availability.status === 'out') {
    const projection = {
      appearanceProbability: 0, startProbability: 0, expectedMinutes: 0, goalRate: null, assistRate: null,
      goalRateSource: 'missing', assistRateSource: 'missing', matchFactor: null, concededRate: null, yellowRate: null, profiles: [],
    };
    return { ...result, index: 0, expectedPoints: 0, unavailable: true, projection, status: 'unavailable', notes: [`Indisponibilità segnalata per la partita. ${availability.reason}.`] };
  }

  const completed = fixtures.filter((match) => finishedBefore(match, fixture));
  const teamGames = completed.filter((match) => hasTeam(match, record.teamId)).length;
  const teamGamesAll = fixtures.filter((match) => COMPLETED.has(statusKey(match.status)) && hasTeam(match, record.teamId)).length;
  if (teamGames < teamGamesAll) {
    return { ...result, teamGames, notes: ['Le statistiche di stagione includono gare della squadra successive alla partita selezionata.'] };
  }
  const playing = playingTime(record, teamGames, availability);
  if (!playing) {
    return { ...result, teamGames, notes: ['Minuti, presenze o partite concluse insufficienti o incoerenti per stimare l’impiego.'] };
  }

  const goalRate = per90(record.goals, record.xg, record.minutes);
  const assistRate = per90(record.assists, record.xa, record.minutes);
  const matchup = fixtureProjection(record, fixture, completed);
  const projection = {
    ...playing,
    ...matchup,
    goalRate: goalRate.value == null ? null : goalRate.value * (matchup.attackFactor ?? 1),
    assistRate: assistRate.value == null ? null : assistRate.value * (matchup.attackFactor ?? 1),
    goalRateSource: goalRate.source,
    assistRateSource: assistRate.source,
    yellowRate: present(record.yellowCards) && record.minutes ? record.yellowCards * 90 / record.minutes : null,
  };
  const ratings = indexComponents({ ...projection, goalRate: goalRate.value, assistRate: assistRate.value }, teamGames, record.position);
  const expectedPoints = expectedScore(projection);
  const notes = [];
  if (!fixture) notes.push('Stima media di stagione senza una partita associata.');
  if (dataset.coverage?.fixtures === 'partial' || dataset.coverage?.results === 'partial') {
    notes.push('Lo storico dei risultati è parziale. Le probabilità riflettono le partite concluse registrate.');
  }
  if (availability.status === 'unknown') notes.push('Disponibilità per la giornata non verificata.');
  if (availability.status === 'reported') {
    const detail = availability.fixtureSpecific ? 'Segnalazione di giornata senza esito confermato.' : 'Segnalazione senza gara associata.';
    notes.push(`${detail} ${availability.reason}.`);
  }
  if (availability.status === 'doubtful') notes.push('Giocatore in dubbio. Il modello riduce del 25% le probabilità d’impiego.');
  if (!record.appearances) notes.push('Nessuna presenza nelle gare concluse della squadra.');
  if (record.minutes > 90 * record.appearances) notes.push('La stima d’impiego limita a 90 i minuti medi per presenza.');
  if (goalRate.source === 'observed') notes.push('Gol attesi dal modello basati sui gol segnati. xG non disponibile.');
  if (assistRate.source === 'observed') notes.push('Assist attesi dal modello basati sugli assist registrati. xA non disponibile.');
  if (expectedPoints == null) notes.push('Dati su gol o assist insufficienti per stimare il fantapunteggio.');
  if (projection.yellowRate == null && projection.appearanceProbability > 0) notes.push('Ammonizioni non incluse per mancanza di dati.');
  if (record.position === 'GK' && projection.concededRate == null && projection.appearanceProbability > 0) notes.push('Malus per gol subiti non incluso per mancanza di uno storico sufficiente.');
  return { ...result, ...ratings, teamGames, expectedPoints, projection, notes, status: expectedPoints == null ? 'partial' : 'estimated' };
}

function createRng(seed) {
  let state = 2166136261;
  for (const character of String(seed)) {
    state ^= character.codePointAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(lambda, rng) {
  if (!(lambda > 0)) return 0;
  let remaining = lambda;
  let events = 0;
  // Splitting the rate keeps the probability calculation stable at extreme rates.
  while (remaining > 0) {
    const interval = Math.min(remaining, 25);
    const threshold = Math.exp(-interval);
    let product = rng();
    while (product > threshold) {
      events += 1;
      product *= rng();
    }
    remaining -= interval;
  }
  return events;
}

function drawScore(projection, rng) {
  const draw = rng();
  let cumulative = 0;
  for (const profile of projection.profiles) {
    cumulative += profile.probability;
    if (draw >= cumulative) continue;
    const exposure = profile.minutes / 90;
    const goals = poisson((projection.goalRate ?? 0) * exposure, rng);
    const assists = poisson((projection.assistRate ?? 0) * exposure, rng);
    const conceded = poisson((projection.concededRate ?? 0) * exposure, rng);
    const yellow = rng() < yellowProbability(projection.yellowRate, profile.minutes);
    return SCORING.appearance + goals * SCORING.goal + assists * SCORING.assist + conceded * SCORING.goalkeeperConceded + Number(yellow) * SCORING.yellowCard;
  }
  return null;
}

function makeHistogram(values) {
  const minimum = values[0];
  const maximum = values.at(-1);
  const width = Math.max(0.5, Math.ceil((maximum - minimum) / 12 * 2) / 2);
  const bins = Array.from({ length: Math.max(1, Math.ceil((maximum - minimum) / width)) }, (_, index) => ({
    from: minimum + index * width,
    to: Math.min(maximum, minimum + (index + 1) * width),
    count: 0,
  }));
  for (const score of values) {
    const index = Math.min(bins.length - 1, Math.floor((score - minimum) / width));
    bins[index].count += 1;
  }
  return bins.map((bin) => ({ ...bin, label: bin.from === bin.to ? String(bin.from) : `${bin.from}–${bin.to}` }));
}

export function simulateLineup(starters, options = {}) {
  const { dataset, round, formation, reserves = [], mode = dataset?.mode, seed = 'fantalab-2026-27' } = options;
  const iterations = clamp(Math.trunc(Number(options.iterations) || 5000), 1, 30000);
  const maxSubstitutions = clamp(Math.trunc(Number(options.maxSubstitutions ?? 3) || 0), 0, 11);
  const empty = { status: 'insufficient', mode, mean: null, p10: null, p50: null, p90: null, min: null, max: null, histogram: [], individual: [], excluded: [], coverage: 0, iterations: 0, seed, notes: [] };
  if (!['demo', 'real'].includes(mode) || dataset?.mode !== mode) {
    return { ...empty, notes: ['Seleziona un archivio compatibile con i giocatori da simulare.'] };
  }

  const lineup = starters.map((player) => dataset.players?.find((item) => sameId(item.id, player?.id)) ?? player);
  if (formation != null) {
    const validation = validateLineup(lineup, formation);
    if (!validation.valid) return { ...empty, status: 'invalid', notes: validation.errors };
  }

  const ids = new Set();
  const excluded = [];
  const entries = [...lineup.map((player) => ({ player, role: 'starter' })), ...reserves.map((player) => ({ player, role: 'reserve' }))].flatMap(({ player, role }) => {
    if (player?.id == null || ids.has(String(player.id))) return [];
    ids.add(String(player.id));
    const record = dataset.players?.find((item) => sameId(item.id, player.id)) ?? player;
    const result = analyzePlayer(record, { dataset, round, mode });
    const missingFixture = round != null && round !== '' && !result.fixture;
    const analysis = missingFixture
      ? { ...result, expectedPoints: null, notes: ['La squadra non ha una partita verificata per la giornata selezionata.'] }
      : result;
    if (analysis.expectedPoints == null) {
      excluded.push({ id: record.id, name: record.name, role, reason: analysis.notes.join(' ') });
    }
    return [{ player: record, role, analysis, points: 0, appearances: 0, used: 0 }];
  });

  const eligibleStarters = entries.filter((entry) => entry.role === 'starter' && entry.analysis.expectedPoints != null);
  const eligibleReserves = entries.filter((entry) => entry.role === 'reserve' && entry.analysis.expectedPoints != null);
  const coverage = lineup.length ? eligibleStarters.length / lineup.length : 0;
  if (!eligibleStarters.length) return { ...empty, coverage, excluded, notes: ['Nessun titolare con dati sufficienti per la simulazione.'] };

  const rng = createRng(seed);
  const values = [];
  for (let trial = 0; trial < iterations; trial += 1) {
    let total = 0;
    let substitutions = 0;
    const missingPositions = Object.fromEntries(POSITIONS.map((position) => [position, 0]));

    for (const entry of eligibleStarters) {
      const score = drawScore(entry.analysis.projection, rng);
      if (score == null) {
        if (POSITIONS.includes(entry.player.position)) missingPositions[entry.player.position] += 1;
        continue;
      }
      total += score;
      entry.points += score;
      entry.used += 1;
      entry.appearances += 1;
    }

    for (const entry of eligibleReserves) {
      const score = drawScore(entry.analysis.projection, rng);
      if (score == null) continue;
      entry.appearances += 1;
      const { position } = entry.player;
      if (!missingPositions[position] || substitutions >= maxSubstitutions) continue;
      missingPositions[position] -= 1;
      substitutions += 1;
      total += score;
      entry.points += score;
      entry.used += 1;
    }
    values.push(total);
  }

  values.sort((first, second) => first - second);
  const quantile = (probability) => values[Math.ceil(probability * iterations) - 1];
  const individual = [...eligibleStarters, ...eligibleReserves].map((entry) => ({
    id: entry.player.id,
    name: entry.player.name,
    role: entry.role,
    mean: entry.points / iterations,
    appearanceProbability: entry.analysis.projection.appearanceProbability,
    sampledAppearanceProbability: entry.appearances / iterations,
    usedProbability: entry.used / iterations,
  }));
  const notes = [
    'Simulazione con eventi indipendenti tra giocatori. Gol, assist e gol subiti seguono distribuzioni di Poisson.',
    'Il modello assegna un voto base di 6 per ogni presenza simulata.',
    `Sostituzioni nell’ordine della panchina e a parità di ruolo. Limite di ${maxSubstitutions} per simulazione.`,
  ];
  if (excluded.length) notes.push('I giocatori con dati insufficienti sono esclusi. Le riserve subentrano solo per le assenze simulate dei titolari con dati sufficienti.');
  return {
    status: excluded.length || coverage < 1 ? 'partial' : 'simulated',
    mode, mean: average(values), p10: quantile(0.1), p50: quantile(0.5), p90: quantile(0.9),
    min: values[0], max: values.at(-1), histogram: makeHistogram(values), individual, excluded, coverage, iterations, seed, notes,
  };
}
