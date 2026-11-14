import { fixtureCalendarDay } from './calendar.js';

const EDITIONS = ['Fantacalcio', 'Statistico', 'Italia'];
const FINISHED = new Set(['played', 'finished', 'ft', 'aet', 'pen', 'awarded']);
const MIN_OBSERVATIONS = 3;
const MIN_VOTES = 2;
const MIN_ROLE_VOTES = 20;
const ROLE_PRIOR = 5;
const MIN_VALIDATION_ROUNDS = 4;
const MIN_VALIDATION_SAMPLES = 150;
const MIN_RELATIVE_GAIN = 0.01;
const RECENCY = 0.82;
const FALLBACK_SD = { GK: 0.45, DEF: 0.45, MID: 0.45, FWD: 0.5 };
const RULES = {
  goals: ['goal', 3], assist: ['assist', 1], penaltyScored: ['penaltyScored', 3],
  penaltySaved: ['penaltySaved', 3], penaltyMissed: ['penaltyMissed', -3], ownGoal: ['ownGoal', -2],
  goalsConceded: ['goalkeeperConceded', -1], yellowCard: ['yellowCard', -0.5], redCard: ['redCard', -1]
};
const EVENT_CAP = { goals: 8, assist: 8, penaltyScored: 4, penaltySaved: 4, penaltyMissed: 4, ownGoal: 4,
  goalsConceded: 15, yellowCard: 2, redCard: 1 };

function weight(scoring, key, defaultValue) {
  return Number.isFinite(scoring?.[key]) ? scoring[key] : defaultValue;
}

function countsFor(position) {
  return Object.keys(RULES).filter(key => position === 'GK' || (key !== 'goalsConceded' && key !== 'penaltySaved'));
}

function readRating(row, edition) {
  const [rating, starred] = row?.votes?.[edition] ?? [];
  return Number.isFinite(rating) && rating >= 0 && rating <= 10 ? { rating, starred: starred === true } : null;
}

export function officialFantasyScore(row, edition, scoring) {
  const vote = readRating(row, edition);
  if (!vote) return null;
  const events = row.events ?? {};
  let points = vote.rating;
  for (const key of countsFor(row.position)) {
    const [rule, defaultValue] = RULES[key];
    const count = events[key];
    if (!Number.isInteger(count) || count < 0) return null;
    points += count * weight(scoring, rule, defaultValue);
  }
  if (row.position === 'GK' && events.goalsConceded === 0) points += weight(scoring, 'cleanSheet', 0);
  return points;
}

function calendarDayAt(time) {
  return Number.isFinite(time) ? fixtureCalendarDay({ kickoff: new Date(time).toISOString() }) : null;
}

function archiveKey(season, round) { return `${season}:${round}`; }

function indexBy(values, keyFor) {
  const index = new Map();
  for (const value of values) {
    const key = keyFor(value);
    const group = index.get(key) ?? [];
    group.push(value);
    index.set(key, group);
  }
  return index;
}

function indexDay(day) {
  return {
    day, teams: new Set(day.teamIds),
    rows: indexBy(day.rows.filter(row => row.id != null), row => row.id),
    unmatched: day.unmatched ?? []
  };
}

function roleBaseline(rows, position, edition) {
  const countKeys = countsFor(position);
  const eventTotals = Object.fromEntries(countKeys.map(key => [key, { sum: 0, count: 0 }]));
  const votes = [];
  for (const row of rows) {
    const vote = readRating(row, edition);
    if (!vote) continue;
    if (!vote.starred) votes.push(vote.rating);
    for (const key of countKeys) {
      const count = row.events?.[key];
      if (!Number.isInteger(count) || count < 0) continue;
      eventTotals[key].sum += Math.min(count, EVENT_CAP[key]);
      eventTotals[key].count++;
    }
  }
  const mean = votes.length ? votes.reduce((sum, value) => sum + value, 0) / votes.length : null;
  const sd = votes.length >= MIN_ROLE_VOTES
    ? Math.sqrt(votes.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (votes.length - 1))
    : FALLBACK_SD[position] ?? 0.45;
  const eventRates = Object.fromEntries(Object.entries(eventTotals).map(([key, { sum, count }]) =>
    [key, count ? sum / count : null]));
  return { eventRates, mean, sd, ratingCount: votes.length, sdFallback: votes.length < MIN_ROLE_VOTES };
}

function playerEventRates(voted, position, baseline) {
  return Object.fromEntries(countsFor(position).map(key => {
    const values = voted.map(row => row.events?.[key]).filter(value => Number.isInteger(value) && value >= 0);
    if (!values.length) return [key, null];
    const sum = values.reduce((total, value) => total + Math.min(value, EVENT_CAP[key]), 0);
    const prior = baseline[key];
    return [key, prior != null ? (sum + ROLE_PRIOR * prior) / (values.length + ROLE_PRIOR) : sum / values.length];
  }));
}

function calculatedMean(averageRating, position, rates, scoring) {
  let points = averageRating;
  for (const [key, rate] of Object.entries(rates)) {
    const [rule, defaultValue] = RULES[key];
    points += (rate ?? 0) * weight(scoring, rule, defaultValue);
  }
  if (position === 'GK' && rates.goalsConceded != null) {
    points += Math.exp(-rates.goalsConceded) * weight(scoring, 'cleanSheet', 0);
  }
  return points;
}

function recentProfile(observations, priorRating, averageRating, voteProbability, nextRound) {
  let weights = 0;
  let voteWeights = 0;
  let weightedRating = 0;
  for (const row of observations) {
    const recency = RECENCY ** (nextRound - row.round - 1);
    weights += recency;
    if (!Number.isFinite(row.rating)) continue;
    voteWeights += recency;
    weightedRating += recency * row.rating;
  }
  const smoothedFrequency = (voteProbability * observations.length + 1) / (observations.length + 2);
  return {
    voteProbability: (voteWeights + 2 * smoothedFrequency) / (weights + 2),
    averageRating: (weightedRating + 2 * (priorRating ?? averageRating)) / (voteWeights + 2)
  };
}

function newLoss() { return { brier: 0, mae: 0, bias: 0 }; }

function addLoss(loss, probability, expectedPoints, outcome) {
  loss.brier += (probability - Number(outcome.rating !== null)) ** 2;
  const error = expectedPoints - (outcome.fantasyRating ?? 0);
  loss.mae += Math.abs(error);
  loss.bias += error;
}

function summarizeValidation(folds, roundLimit, cutoffDay) {
  const relevant = folds.filter(fold => fold.round < roundLimit && fold.lastDay < cutoffDay);
  const samples = relevant.reduce((total, fold) => total + fold.samples, 0);
  function average(method) {
    return Object.fromEntries(Object.keys(newLoss()).map(metric => [metric, samples
      ? relevant.reduce((total, fold) => total + fold[method][metric], 0) / samples : null]));
  }
  const history = average('history');
  const adaptive = average('adaptive');
  const rounds = relevant.length;
  const enough = samples >= MIN_VALIDATION_SAMPLES && rounds >= MIN_VALIDATION_ROUNDS;
  const improved = adaptive.brier < history.brier * (1 - MIN_RELATIVE_GAIN)
    && adaptive.mae < history.mae * (1 - MIN_RELATIVE_GAIN);
  return {
    model: enough && improved ? 'adaptive' : 'history',
    samples, rounds, minimumSamples: MIN_VALIDATION_SAMPLES, minimumRounds: MIN_VALIDATION_ROUNDS,
    history, adaptive, replay: average('replay'),
    adaptiveRounds: relevant.filter(fold => fold.adaptiveSelected).length
  };
}

export function buildOfficialVoteIndex(days, { edition = 'Fantacalcio', scoring } = {}) {
  if (!EDITIONS.includes(edition)) edition = EDITIONS[0];
  const source = `Fantacalcio.it · ${edition} · Excel personale`;
  const sourceId = `fantacalcio-xlsx:${edition}`;
  const archived = new Map(days.map(day => [archiveKey(day.season, day.round), indexDay(day)]));
  const archiveDays = [...archived.values()].sort((a, b) => a.day.round - b.day.round);
  const rosterEvidence = new Map();
  for (const entry of archiveDays) {
    for (const row of entry.day.rows) {
      if (row.id == null) continue;
      const key = archiveKey(entry.day.season, row.id);
      const teams = rosterEvidence.get(key) ?? new Map();
      if (!teams.has(row.teamId)) teams.set(row.teamId, entry.day.round);
      rosterEvidence.set(key, teams);
    }
  }
  const bySchedule = new WeakMap();

  function record(player, season, round, playedBefore) {
    const entry = archived.get(archiveKey(season, round));
    if (!entry) return undefined;
    const rows = entry.rows.get(player.id) ?? [];
    if (rows.length > 1) return undefined;
    const row = rows[0];
    if (row) {
      const vote = readRating(row, edition);
      if (!vote) return undefined;
      return { ...vote, fantasyRating: officialFantasyScore(row, edition, scoring), events: row.events,
        teamId: row.teamId, round, observed: true, source, sourceId };
    }
    if (!entry.day.complete || !entry.teams.has(player.teamId)) return undefined;
    const teams = rosterEvidence.get(archiveKey(season, player.id));
    const firstAtCurrentTeam = teams?.get(player.teamId);
    const knownByRound = ([teamId, firstRound]) => firstRound <= round && (!playedBefore || playedBefore(teamId, firstRound));
    if (firstAtCurrentTeam == null || !knownByRound([player.teamId, firstAtCurrentTeam])) return undefined;
    if ([...teams].some(([teamId, firstRound]) => teamId !== player.teamId && knownByRound([teamId, firstRound]))) return undefined;
    const couldBeUnmatched = entry.unmatched.some(item =>
      item.candidateIds?.includes(player.id)
      || (item.teamId === player.teamId && (!item.position || item.position === player.position)
        && !item.candidateIds?.length));
    if (couldBeUnmatched) return undefined;
    return { rating: null, fantasyRating: null, starred: false, events: null,
      teamId: player.teamId, round, observed: true, source, sourceId };
  }

  function history(player, season, playedBefore, beforeRound = Infinity) {
    return archiveDays.filter(entry => entry.day.season === season && entry.day.round < beforeRound)
      .flatMap(entry => record(player, season, entry.day.round, playedBefore) ?? []);
  }

  function scheduleFor(fixtures) {
    let schedule = bySchedule.get(fixtures);
    if (!schedule) {
      const matches = fixtures.map(fixture => ({ ...fixture, day: fixtureCalendarDay(fixture),
        final: FINISHED.has(String(fixture.status ?? '').toLowerCase()) }));
      const teams = indexBy(matches.flatMap(match => [match.homeId, match.awayId].map(teamId => ({ match, teamId }))),
        ({ teamId, match }) => archiveKey(teamId, match.round));
      schedule = { baselines: new Map(), folds: new Map(), matches: indexBy(matches, match => match.round),
        playedBefore(teamId, round, cutoffDay) {
          const games = teams.get(archiveKey(teamId, round)) ?? [];
          return games.length === 1 && games[0].match.final && games[0].match.day !== null && games[0].match.day < cutoffDay;
        } };
      bySchedule.set(fixtures, schedule);
    }
    return schedule;
  }

  function profile(player, season, round, cutoffDay, schedule) {
    const played = (teamId, day) => schedule.playedBefore(teamId, day, cutoffDay);
    const observations = history(player, season, played, round).filter(row => played(row.teamId, row.round));
    const voted = observations.filter(row => Number.isFinite(row.rating));
    if (observations.length < MIN_OBSERVATIONS || voted.length < MIN_VOTES) return null;
    const baselineKey = `${season}:${round}:${cutoffDay}:${player.position}`;
    if (!schedule.baselines.has(baselineKey)) {
      const roleRows = archiveDays.filter(entry => entry.day.season === season && entry.day.round < round)
        .flatMap(entry => entry.day.rows.filter(row => row.position === player.position && played(row.teamId, entry.day.round)));
      schedule.baselines.set(baselineKey, roleBaseline(roleRows, player.position, edition));
    }
    const baseline = schedule.baselines.get(baselineKey);
    const averageRating = voted.reduce((sum, row) => sum + row.rating, 0) / voted.length;
    const eventRates = playerEventRates(voted, player.position, baseline.eventRates);
    const voteProbability = voted.length / observations.length;
    return { baseline, eventRates, observations, voted, history: { averageRating, voteProbability },
      adaptive: recentProfile(observations, baseline.mean, averageRating, voteProbability, round) };
  }

  function validationFolds(season, schedule) {
    if (schedule.folds.has(season)) return schedule.folds.get(season);
    const days = archiveDays.filter(entry => entry.day.season === season);
    const folds = [];
    for (const entry of days.slice(MIN_OBSERVATIONS)) {
      const { round, complete } = entry.day;
      const games = schedule.matches.get(round) ?? [];
      const playingTeams = new Set(games.flatMap(match => [match.homeId, match.awayId]));
      if (!complete || !games.length || games.some(match => !match.final || !match.day) || playingTeams.size !== 2 * games.length ||
        playingTeams.size !== entry.teams.size || [...entry.teams].some(team => !playingTeams.has(team))) continue;
      const matchDays = games.map(match => match.day).sort();
      const cutoff = matchDays[0];
      const lastDay = matchDays.at(-1);
      const report = summarizeValidation(folds, round, cutoff);
      const adaptiveSelected = report.model === 'adaptive';
      const players = new Map();
      for (const { day } of days) {
        if (day.round >= round) break;
        for (const player of day.rows) {
          if (player.id != null && schedule.playedBefore(player.teamId, day.round, cutoff)) players.set(player.id, player);
        }
      }
      const fold = { round, lastDay, adaptiveSelected, samples: 0, history: newLoss(), adaptive: newLoss(), replay: newLoss() };
      const played = (teamId, day) => schedule.playedBefore(teamId, day, cutoff);
      for (const player of players.values()) {
        if (!playingTeams.has(player.teamId)) continue;
        const outcome = record(player, season, round, played);
        if (!outcome || outcome.teamId !== player.teamId || (outcome.rating !== null && !Number.isFinite(outcome.fantasyRating))) continue;
        const candidate = profile(player, season, round, cutoff, schedule);
        if (!candidate) continue;
        for (const method of ['history', 'adaptive']) {
          const prediction = candidate[method];
          const expected = prediction.voteProbability * calculatedMean(prediction.averageRating, player.position, candidate.eventRates, scoring);
          addLoss(fold[method], prediction.voteProbability, expected, outcome);
          if ((method === 'adaptive') === adaptiveSelected) addLoss(fold.replay, prediction.voteProbability, expected, outcome);
        }
        fold.samples++;
      }
      if (fold.samples) folds.push(fold);
    }
    schedule.folds.set(season, folds);
    return folds;
  }

  function validation({ season, fixtures = [], asOf = Date.now(), beforeRound = Infinity }) {
    const cutoffDay = calendarDayAt(new Date(asOf).valueOf()) ?? '';
    return summarizeValidation(validationFolds(season, scheduleFor(fixtures)), beforeRound, cutoffDay);
  }

  function project(player, { season, fixture, fixtures = [], asOf = Date.now() }) {
    const beforeDay = calendarDayAt(new Date(asOf).valueOf());
    const fixtureDay = fixtureCalendarDay(fixture ?? {});
    if (!beforeDay || !fixtureDay || !Number.isInteger(fixture.round)) return null;
    const cutoffDay = beforeDay < fixtureDay ? beforeDay : fixtureDay;
    const schedule = scheduleFor(fixtures);
    const candidate = profile(player, season, fixture.round, cutoffDay, schedule);
    if (!candidate) return null;
    const { baseline, eventRates, observations, voted } = candidate;
    const report = summarizeValidation(validationFolds(season, schedule), fixture.round, cutoffDay);
    const { averageRating, voteProbability } = candidate[report.model];
    const conditionalMean = calculatedMean(averageRating, player.position, eventRates, scoring);
    return {
      method: 'official-history', voteProbability, scores: [conditionalMean],
      sample: { observations: observations.length, votes: voted.length, rounds: observations.map(row => row.round),
        asOfRound: observations.at(-1).round, source, sourceId, averageRating, ratingSd: baseline.sd,
        ratingCount: baseline.ratingCount, sdFallback: baseline.sdFallback, eventRates, rolePrior: ROLE_PRIOR,
        calibrationModel: report.model, validation: { rounds: report.rounds, samples: report.samples },
        rigoristaCandidate: voted.some(row => (row.events?.penaltyScored ?? 0) + (row.events?.penaltyMissed ?? 0) > 0) },
      official: { averageRating, ratingSd: baseline.sd, eventRates, scoring, position: player.position }
    };
  }

  return { source, sourceId, record, history, project, validation };
}

function drawCount(rate, rng) {
  if (!(rate > 0)) return 0;
  const threshold = Math.exp(-rate);
  let product = 1;
  let count = -1;
  do {
    count++;
    product *= rng();
  } while (product > threshold);
  return count;
}

export function drawOfficialFantasy(projection, rng) {
  const { averageRating, ratingSd, eventRates, scoring, position } = projection.official;
  const deviation = ratingSd * Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  const limit = Math.min(averageRating, 10 - averageRating);
  const vote = averageRating + Math.max(-limit, Math.min(limit, deviation));
  let points = vote;
  let conceded = null;
  for (const [key, rate] of Object.entries(eventRates)) {
    if (rate === null) continue;
    const eventCount = drawCount(rate, rng);
    const [rule, defaultValue] = RULES[key];
    points += eventCount * weight(scoring, rule, defaultValue);
    if (key === 'goalsConceded') conceded = eventCount;
  }
  if (position === 'GK' && conceded === 0) points += weight(scoring, 'cleanSheet', 0);
  return { points, vote };
}
