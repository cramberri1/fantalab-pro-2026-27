import { fixtureCalendarDay } from './calendar.js';

const MIN_LEAGUE_MATCHES = 12;
const PRIOR_TEAM_WEIGHT = 4;
const NEUTRAL_TEAM_WEIGHT = 6;
const MIN_DIXON_COLES_SAMPLE = 50;
const MAX_RHO_HUNDREDTHS = 18;

function matchDay(fixture) {
  if (!fixture?.homeId || !fixture.awayId || fixture.homeId === fixture.awayId) return null;
  const day = fixtureCalendarDay(fixture);
  return /^\d{4}-\d{2}-\d{2}$/.test(day ?? '') ? day : null;
}

function completedGames(fixtures, archive = false) {
  return fixtures.flatMap(fixture => {
    if (fixture?.status !== 'played' && !(archive && fixture?.status == null)) return [];
    const day = matchDay(fixture);
    if (!day || ![fixture.homeGoals, fixture.awayGoals].every(value => Number.isInteger(value) && value >= 0)) return [];
    return [{ fixture, day }];
  });
}

function summarize(games, day) {
  const home = new Map();
  const away = new Map();
  const league = { matches: 0, scored: 0, conceded: 0 };
  function add(side, id, scored, conceded) {
    const team = side.get(id) ?? { matches: 0, scored: 0, conceded: 0 };
    team.matches += 1;
    team.scored += scored;
    team.conceded += conceded;
    side.set(id, team);
  }
  for (const game of games) {
    if (game.day >= day) continue;
    const { homeId, awayId, homeGoals, awayGoals } = game.fixture;
    add(home, homeId, homeGoals, awayGoals);
    add(away, awayId, awayGoals, homeGoals);
    league.matches += 1;
    league.scored += homeGoals;
    league.conceded += awayGoals;
  }
  return { home, away, league };
}

function smoothedRate(current, prior, field, leagueRate) {
  const priorMatches = prior?.matches ?? 0;
  const priorWeight = Math.min(priorMatches, PRIOR_TEAM_WEIGHT);
  const priorGoals = priorMatches ? prior[field] * priorWeight / priorMatches : 0;
  return ((current?.[field] ?? 0) + priorGoals + NEUTRAL_TEAM_WEIGHT * leagueRate) /
    ((current?.matches ?? 0) + priorWeight + NEUTRAL_TEAM_WEIGHT);
}

function boundRate(rate) {
  return Math.max(0.15, Math.min(5, rate));
}

function poisson(lambda) {
  const probabilities = [Math.exp(-lambda)];
  for (let goals = 1; goals <= 24; goals++) {
    probabilities.push(probabilities[goals - 1] * lambda / goals);
  }
  return probabilities;
}

function threeWayMass(homeRate, awayRate) {
  const home = poisson(homeRate);
  const away = poisson(awayRate);
  const outcomes = [0, 0, 0];
  for (const [homeGoals, homeProbability] of home.entries()) {
    for (const [awayGoals, awayProbability] of away.entries()) {
      const outcome = homeGoals > awayGoals ? 0 : homeGoals === awayGoals ? 1 : 2;
      outcomes[outcome] += homeProbability * awayProbability;
    }
  }
  return outcomes;
}

function normalize(outcomes) {
  const total = outcomes.reduce((sum, value) => sum + value, 0);
  return outcomes.map(value => value / total);
}

function ratesForMatch(fixture, day, currentGames, priorGames, byDay) {
  if (!day) return null;
  if (!byDay.has(day)) byDay.set(day, [summarize(currentGames, day), summarize(priorGames, day)]);
  const [current, prior] = byDay.get(day);
  const leagueMatches = current.league.matches + prior.league.matches;
  if (leagueMatches < MIN_LEAGUE_MATCHES) return null;

  const leagueHomeRate = boundRate((current.league.scored + prior.league.scored) / leagueMatches);
  const leagueAwayRate = boundRate((current.league.conceded + prior.league.conceded) / leagueMatches);
  const currentHome = current.home.get(fixture.homeId);
  const currentAway = current.away.get(fixture.awayId);
  const priorHome = prior.home.get(fixture.homeId);
  const priorAway = prior.away.get(fixture.awayId);
  const homeAttack = smoothedRate(currentHome, priorHome, 'scored', leagueHomeRate);
  const awayDefense = smoothedRate(currentAway, priorAway, 'conceded', leagueHomeRate);
  const awayAttack = smoothedRate(currentAway, priorAway, 'scored', leagueAwayRate);
  const homeDefense = smoothedRate(currentHome, priorHome, 'conceded', leagueAwayRate);
  // Venue-specific league rates give the neutral team matchup its home advantage.
  const homeRate = boundRate(leagueHomeRate * (homeAttack / leagueHomeRate) * (awayDefense / leagueHomeRate));
  const awayRate = boundRate(leagueAwayRate * (awayAttack / leagueAwayRate) * (homeDefense / leagueAwayRate));
  return {
    leagueHomeRate,
    leagueAwayRate,
    homeAdvantage: leagueHomeRate / leagueAwayRate,
    homeRate,
    awayRate,
    priorMatches: prior.league.matches,
    currentMatches: current.league.matches,
    home: { priorMatches: priorHome?.matches ?? 0, currentMatches: currentHome?.matches ?? 0 },
    away: { priorMatches: priorAway?.matches ?? 0, currentMatches: currentAway?.matches ?? 0 }
  };
}

function feasibleRho(rho, homeRate, awayRate) {
  // Keep each of the four corrected scoreline probabilities strictly positive.
  return Math.max(-0.99 / Math.max(homeRate, awayRate), Math.min(rho, 0.99 / (homeRate * awayRate)));
}

function lowScoreSlope(homeGoals, awayGoals, homeRate, awayRate) {
  if (homeGoals > 1 || awayGoals > 1) return 0;
  if (homeGoals === 0 && awayGoals === 0) return -homeRate * awayRate;
  if (homeGoals === 1 && awayGoals === 1) return -1;
  return homeGoals === 0 ? homeRate : awayRate;
}

function fitDixonColes(observations, day) {
  const before = observations.filter(observation => observation.day < day);
  if (before.length < MIN_DIXON_COLES_SAMPLE) return null;
  const lowScores = before.filter(observation => observation.slope !== 0);
  let bestRho = 0;
  let bestLikelihood = 0;
  for (let step = -MAX_RHO_HUNDREDTHS; step <= MAX_RHO_HUNDREDTHS; step++) {
    const rho = step / 100;
    const likelihood = lowScores.reduce((sum, row) =>
      sum + Math.log1p(row.slope * feasibleRho(rho, row.homeRate, row.awayRate)), 0);
    if (likelihood > bestLikelihood) {
      bestRho = rho;
      bestLikelihood = likelihood;
    }
  }
  return bestRho;
}

function matchObservation(game, rates) {
  const { homeGoals, awayGoals } = game.fixture;
  const { homeRate, awayRate } = rates;
  return {
    day: game.day, homeRate, awayRate,
    outcome: homeGoals > awayGoals ? 0 : homeGoals === awayGoals ? 1 : 2,
    slope: lowScoreSlope(homeGoals, awayGoals, homeRate, awayRate)
  };
}

function correctedProbabilities(mass, homeRate, awayRate, rho) {
  // The Dixon–Coles weights move equal mass to 1–0 and 0–1 from 0–0 and 1–1.
  const adjustment = Math.exp(-(homeRate + awayRate)) * homeRate * awayRate * rho;
  return normalize([mass[0] + adjustment, mass[1] - 2 * adjustment, mass[2] + adjustment]);
}

function accumulate(loss, probabilities, outcome) {
  probabilities.forEach((p, index) => { loss.brier += (p - Number(index === outcome)) ** 2; });
  loss.logLoss -= Math.log(probabilities[outcome]);
}

function evaluateModels(current, prior, cutoff = '9999-12-31') {
  const priorByDay = new Map();
  const currentByDay = new Map();
  const observations = [];
  const fitted = new Map();
  for (const game of prior) {
    if (game.day >= cutoff) continue;
    const rates = ratesForMatch(game.fixture, game.day, prior, [], priorByDay);
    if (rates) observations.push(matchObservation(game, rates));
  }
  let matches = 0;
  let dixonColesMatches = 0;
  const model = { brier: 0, logLoss: 0 };
  const baseline = { brier: 0, logLoss: 0 };
  const dixonColes = { brier: 0, logLoss: 0 };
  const games = current.filter(game => game.day < cutoff).sort((a, b) => a.day.localeCompare(b.day));
  for (const game of games) {
    const { fixture, day } = game;
    const rates = ratesForMatch(fixture, day, current, prior, currentByDay);
    if (!rates) continue;
    const { homeRate, awayRate, leagueHomeRate, leagueAwayRate } = rates;
    const mass = threeWayMass(homeRate, awayRate);
    const original = normalize(mass);
    const observation = matchObservation(game, rates);
    if (!fitted.has(day)) fitted.set(day, fitDixonColes(observations, day));
    const rho = fitted.get(day);
    const corrected = rho === null ? original
      : correctedProbabilities(mass, homeRate, awayRate, feasibleRho(rho, homeRate, awayRate));
    accumulate(model, original, observation.outcome);
    accumulate(baseline, normalize(threeWayMass(leagueHomeRate, leagueAwayRate)), observation.outcome);
    accumulate(dixonColes, corrected, observation.outcome);
    observations.push(observation);
    if (rho !== null) dixonColesMatches++;
    matches++;
  }
  const average = loss => ({
    brier: matches ? loss.brier / matches : null,
    logLoss: matches ? loss.logLoss / matches : null
  });
  const selectedModel = dixonColesMatches >= MIN_DIXON_COLES_SAMPLE && dixonColes.brier < model.brier
    && dixonColes.logLoss < model.logLoss ? 'dixon-coles' : 'poisson';
  return {
    matches, dixonColesMatches, model: average(model), baseline: average(baseline),
    dixonColes: dixonColesMatches ? average(dixonColes) : { brier: null, logLoss: null },
    selectedModel, observations
  };
}

export function predictMatch(fixture, fixtures, priorFixtures = []) {
  const current = completedGames(fixtures);
  const prior = completedGames(priorFixtures, true);
  const day = matchDay(fixture);
  const rates = ratesForMatch(fixture, day, current, prior, new Map());
  if (!rates) return null;
  const { homeRate, awayRate, leagueHomeRate, leagueAwayRate } = rates;
  const comparison = evaluateModels(current, prior, day);
  const model = comparison.selectedModel;
  const rho = model === 'dixon-coles'
    ? feasibleRho(fitDixonColes(comparison.observations, day), homeRate, awayRate)
    : null;
  const mass = threeWayMass(homeRate, awayRate);
  return {
    ...rates,
    probabilities: rho === null ? normalize(mass) : correctedProbabilities(mass, homeRate, awayRate, rho),
    baseline: normalize(threeWayMass(leagueHomeRate, leagueAwayRate)),
    model, rho, selectionMatches: comparison.dixonColesMatches
  };
}

export function predictMatchRates(fixture, fixtures, priorFixtures = []) {
  return ratesForMatch(fixture, matchDay(fixture), completedGames(fixtures), completedGames(priorFixtures, true), new Map());
}

export function matchScoreSampler(prediction) {
  if (!prediction) return null;
  const { homeRate, awayRate, rho } = prediction;
  const home = poisson(homeRate);
  const away = poisson(awayRate);
  const outcomes = [];
  let cumulative = 0;
  for (const [h, hp] of home.entries()) {
    for (const [a, ap] of away.entries()) {
      cumulative += hp * ap * (1 + (rho ?? 0) * lowScoreSlope(h, a, homeRate, awayRate));
      outcomes.push({ h, a, cumulative });
    }
  }
  return { homeRate, awayRate, sampleScore(rng) {
    const point = rng() * cumulative;
    let first = 0;
    let last = outcomes.length - 1;
    while (first < last) {
      const middle = Math.floor((first + last) / 2);
      if (point < outcomes[middle].cumulative) last = middle;
      else first = middle + 1;
    }
    return [outcomes[first].h, outcomes[first].a];
  } };
}

export function backtestMatches(fixtures, priorFixtures = []) {
  const current = completedGames(fixtures);
  const prior = completedGames(priorFixtures, true);
  const { observations, ...report } = evaluateModels(current, prior);
  const playedCount = fixtures.filter(fixture => fixture?.status === 'played').length;
  return { ...report, excluded: playedCount - report.matches };
}
