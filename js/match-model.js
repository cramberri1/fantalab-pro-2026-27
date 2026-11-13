import { fixtureCalendarDay } from './calendar.js';

const MIN_LEAGUE_MATCHES = 12;
const PRIOR_TEAM_WEIGHT = 4;
const NEUTRAL_TEAM_WEIGHT = 6;

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

function threeWay(homeRate, awayRate) {
  const home = poisson(homeRate);
  const away = poisson(awayRate);
  const outcomes = [0, 0, 0];
  for (const [homeGoals, homeProbability] of home.entries()) {
    for (const [awayGoals, awayProbability] of away.entries()) {
      const outcome = homeGoals > awayGoals ? 0 : homeGoals === awayGoals ? 1 : 2;
      outcomes[outcome] += homeProbability * awayProbability;
    }
  }
  const total = outcomes.reduce((sum, value) => sum + value, 0);
  return outcomes.map(value => value / total);
}

function predictFromGames(fixture, day, currentGames, priorGames) {
  if (!day) return null;
  const current = summarize(currentGames, day);
  const prior = summarize(priorGames, day);
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
  const homeRate = boundRate(homeAttack * awayDefense / leagueHomeRate);
  const awayRate = boundRate(awayAttack * homeDefense / leagueAwayRate);
  return {
    probabilities: threeWay(homeRate, awayRate),
    baseline: threeWay(leagueHomeRate, leagueAwayRate),
    homeRate,
    awayRate,
    priorMatches: prior.league.matches,
    currentMatches: current.league.matches,
    home: { priorMatches: priorHome?.matches ?? 0, currentMatches: currentHome?.matches ?? 0 },
    away: { priorMatches: priorAway?.matches ?? 0, currentMatches: currentAway?.matches ?? 0 }
  };
}

export function predictMatch(fixture, fixtures, priorFixtures = []) {
  return predictFromGames(fixture, matchDay(fixture), completedGames(fixtures), completedGames(priorFixtures, true));
}

function accumulate(loss, probabilities, outcome) {
  probabilities.forEach((p, index) => { loss.brier += (p - Number(index === outcome)) ** 2; });
  loss.logLoss -= Math.log(probabilities[outcome]);
}

export function backtestMatches(fixtures, priorFixtures = []) {
  const current = completedGames(fixtures);
  const prior = completedGames(priorFixtures, true);
  const playedCount = fixtures.filter(fixture => fixture?.status === 'played').length;
  let matches = 0;
  const model = { brier: 0, logLoss: 0 };
  const baseline = { brier: 0, logLoss: 0 };
  for (const { fixture, day } of current) {
    const prediction = predictFromGames(fixture, day, current, prior);
    if (!prediction) continue;
    const outcome = fixture.homeGoals > fixture.awayGoals ? 0 : fixture.homeGoals === fixture.awayGoals ? 1 : 2;
    accumulate(model, prediction.probabilities, outcome);
    accumulate(baseline, prediction.baseline, outcome);
    matches++;
  }
  const average = loss => ({
    brier: matches ? loss.brier / matches : null,
    logLoss: matches ? loss.logLoss / matches : null
  });
  return { matches, excluded: playedCount - matches, model: average(model), baseline: average(baseline) };
}
