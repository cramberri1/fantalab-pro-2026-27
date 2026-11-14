const EDITIONS = ['Fantacalcio', 'Statistico', 'Italia'];
const FINISHED = new Set(['played', 'finished', 'ft', 'aet', 'pen', 'awarded']);
const MIN_OBSERVATIONS = 3;
const MIN_VOTES = 2;
const MIN_ROLE_VOTES = 20;
const ROLE_PRIOR = 5;
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

function fixtureTime(fixture) {
  const time = Date.parse(fixture?.kickoff ?? '');
  return Number.isFinite(time) ? time : Date.parse(fixture?.date ? `${fixture.date}T23:59:59+01:00` : '');
}

function finalBefore(fixture, cutoff) {
  return FINISHED.has(String(fixture?.status ?? '').toLowerCase()) && fixtureTime(fixture) < cutoff;
}

function finishedCountBefore(times, cutoff) {
  let lower = 0;
  let upper = times.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (times[middle] < cutoff) lower = middle + 1;
    else upper = middle;
  }
  return lower;
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
  return { eventRates, sd, ratingCount: votes.length, sdFallback: votes.length < MIN_ROLE_VOTES };
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

  function record(player, season, round) {
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
    if (!entry.teams.has(player.teamId)) return undefined;
    const teams = rosterEvidence.get(archiveKey(season, player.id));
    const firstAtCurrentTeam = teams?.get(player.teamId);
    if (firstAtCurrentTeam == null || firstAtCurrentTeam > round) return undefined;
    // After a known transfer only an explicit row identifies the club at match time.
    if (teams.size > 1) return undefined;
    const couldBeUnmatched = entry.unmatched.some(item =>
      item.candidateIds?.includes(player.id)
      || (item.teamId === player.teamId && (!item.position || item.position === player.position)
        && !item.candidateIds?.length));
    if (couldBeUnmatched) return undefined;
    return { rating: null, fantasyRating: null, starred: false, events: null,
      teamId: player.teamId, round, observed: true, source, sourceId };
  }

  function history(player, season) {
    return archiveDays.filter(entry => entry.day.season === season)
      .flatMap(entry => record(player, season, entry.day.round) ?? []);
  }

  function project(player, { season, fixture, fixtures = [], asOf = Date.now() }) {
    const cutoff = Math.min(new Date(asOf).valueOf(), fixtureTime(fixture));
    if (!Number.isFinite(cutoff) || !Number.isInteger(fixture?.round)) return null;
    let schedule = bySchedule.get(fixtures);
    if (!schedule) {
      schedule = indexBy(fixtures.flatMap(match => [match.homeId, match.awayId].map(teamId => ({ match, teamId }))),
        ({ teamId, match }) => archiveKey(teamId, match.round));
      schedule.baselines = new Map();
      schedule.finishedTimes = fixtures.filter(match => FINISHED.has(String(match.status ?? '').toLowerCase()))
        .map(fixtureTime).filter(Number.isFinite).sort((a, b) => a - b);
      bySchedule.set(fixtures, schedule);
    }
    const played = (teamId, round) => {
      const games = schedule.get(archiveKey(teamId, round)) ?? [];
      return games.length === 1 && finalBefore(games[0].match, cutoff);
    };
    const observations = history(player, season).filter(row => row.round < fixture.round && played(row.teamId, row.round));
    const voted = observations.filter(row => Number.isFinite(row.rating));
    if (observations.length < MIN_OBSERVATIONS || voted.length < MIN_VOTES) return null;
    const baselineKey = `${season}:${fixture.round}:${finishedCountBefore(schedule.finishedTimes, cutoff)}:${player.position}`;
    if (!schedule.baselines.has(baselineKey)) {
      const roleRows = archiveDays.filter(entry => entry.day.season === season && entry.day.round < fixture.round)
        .flatMap(entry => entry.day.rows.filter(row => row.position === player.position && played(row.teamId, entry.day.round)));
      schedule.baselines.set(baselineKey, roleBaseline(roleRows, player.position, edition));
    }
    const baseline = schedule.baselines.get(baselineKey);
    const averageRating = voted.reduce((sum, row) => sum + row.rating, 0) / voted.length;
    const eventRates = playerEventRates(voted, player.position, baseline.eventRates);
    const conditionalMean = calculatedMean(averageRating, player.position, eventRates, scoring);
    return {
      method: 'official-history', voteProbability: voted.length / observations.length, scores: [conditionalMean],
      sample: { observations: observations.length, votes: voted.length, rounds: observations.map(row => row.round),
        asOfRound: observations.at(-1).round, source, sourceId, averageRating, ratingSd: baseline.sd,
        ratingCount: baseline.ratingCount, sdFallback: baseline.sdFallback, eventRates, rolePrior: ROLE_PRIOR,
        rigoristaCandidate: voted.some(row => (row.events?.penaltyScored ?? 0) + (row.events?.penaltyMissed ?? 0) > 0) },
      official: { averageRating, ratingSd: baseline.sd, eventRates, scoring, position: player.position }
    };
  }

  return { source, sourceId, record, history, project };
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
