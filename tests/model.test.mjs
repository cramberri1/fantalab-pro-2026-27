import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePlayer, getPlayerFixture, simulateLineup, validateLineup } from '../js/model.js';

const now = { id: 'week5', round: 5, homeId: 'a', awayId: 'b', kickoff: '2026-09-30T18:45:00Z', status: 'scheduled' };
const fixtures = Array.from({ length: 4 }, (_, index) => ({
  id: `week${index + 1}`,
  round: index + 1,
  homeId: 'a',
  awayId: 'c',
  kickoff: `2026-09-${String((index + 1) * 5).padStart(2, '0')}T18:45:00Z`,
  status: 'played',
  homeGoals: 1,
  awayGoals: 0,
}));
const forward = { id: 'f', name: 'Attaccante', position: 'FWD', teamId: 'a', appearances: 4, starts: 4, minutes: 360, goals: 0, assists: 0, xg: null, xa: null, yellowCards: 0 };
const alternate = { ...forward, id: 'r', name: 'Riserva' };
const dataset = { mode: 'demo', fixtures: [...fixtures, now], players: [forward, alternate], absences: [] };

test('real zeros count and null expected metrics stay missing', () => {
  const result = analyzePlayer(forward, { dataset });
  assert.equal(getPlayerFixture(forward, dataset.fixtures).id, now.id);
  assert.equal(result.availability.status, 'unknown');
  assert.equal(result.projection.goalRateSource, 'observed');
  assert.equal(result.projection.assistRateSource, 'observed');
  assert.equal(result.projection.goalRate, 0);
  assert.equal(result.expectedPoints, 6);
  assert.equal(result.coverage, 0.9);
  assert.equal(result.index, Math.round(result.components.reduce((total, component) => total + (component.contribution ?? 0), 0)));
});

test('missing goals stay missing and prevent points simulation', () => {
  const unknown = { ...forward, goals: null };
  const incomplete = { ...dataset, players: [unknown] };
  const result = analyzePlayer(unknown, { dataset: incomplete });
  assert.equal(result.expectedPoints, null);
  assert.equal(result.projection.goalRate, null);
  assert.equal(result.status, 'partial');
  const run = simulateLineup([unknown], { dataset: incomplete });
  assert.equal(run.status, 'insufficient');
  assert.equal(run.excluded[0].id, unknown.id);
  assert.equal(run.mean, null);
});

test('closed fixtures and demo records do not produce real projections', () => {
  assert.equal(analyzePlayer(forward, { dataset, round: 4 }).status, 'historical');
  assert.equal(analyzePlayer(forward, { dataset, mode: 'real' }).expectedPoints, null);
  assert.equal(simulateLineup([forward], { dataset, mode: 'real' }).mean, null);
});

test('fixture absence admits first available bench player of the same role', () => {
  const fixtureDataset = { ...dataset, absences: [{ playerId: forward.id, fixtureId: now.id, status: 'out', reason: 'Squalifica' }] };
  assert.equal(analyzePlayer(forward, { dataset: fixtureDataset }).expectedPoints, 0);
  const run = simulateLineup([forward], { dataset: fixtureDataset, reserves: [alternate], iterations: 30 });
  assert.equal(run.status, 'simulated');
  assert.equal(run.mean, 6);
  assert.equal(run.p10, 6);
  assert.equal(run.individual[0].usedProbability, 0);
  assert.equal(run.individual[1].usedProbability, 1);
  assert.equal(simulateLineup([forward], { dataset: fixtureDataset, reserves: [alternate], maxSubstitutions: 0, iterations: 30 }).mean, 0);
});

test('seeded simulations reproduce their distribution and approximate analytical points', () => {
  const variable = { ...forward, appearances: 2, starts: 1, minutes: 90, goals: 1, xg: 0.6, assists: 1, xa: 0.3, yellowCards: 1 };
  const sample = { ...dataset, players: [variable] };
  const options = { dataset: sample, iterations: 16000, seed: 'repeat' };
  const expected = analyzePlayer(variable, { dataset: sample }).expectedPoints;
  const run = simulateLineup([variable], options);
  assert.ok(Math.abs(run.mean - expected) < 0.1);
  assert.ok(Math.abs(run.individual[0].sampledAppearanceProbability - 0.5) < 0.02);
  assert.equal(run.histogram.reduce((total, bin) => total + bin.count, 0), run.iterations);
  assert.deepEqual(run, simulateLineup([variable], options));
});

test('formation validation counts unique players by role', () => {
  const players = ['GK', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD'].map((position, id) => ({ id, position, name: String(id) }));
  assert.equal(validateLineup(players, '3-4-3').valid, true);
  const invalid = validateLineup([...players.slice(0, -1), players[0]], '3-4-3');
  assert.equal(invalid.valid, false);
  assert.equal(invalid.missing.FWD, 1);
});

const predictionTime = '2026-09-29T18:45:00Z';
const fantasyOnly = {
  id: 'rated', name: 'Giocatore FantaTB', position: 'FWD', teamId: 'a',
  ratings: [
    { round: 1, rating: 6, fantasyRating: 5 },
    { round: 2, rating: null, fantasyRating: null },
    { round: 4, rating: 7, fantasyRating: 10 },
    { round: 5, rating: 8, fantasyRating: 12 },
  ],
};
const fantasyArchive = {
  id: 'transferbeat-ratings', ambiguousRatings: 0,
  archives: [1, 2, 3, 4, 5].map(round => ({ round, updatedAt: `2026-09-${String(round * 5 + 1).padStart(2, '0')}T18:45:00Z` })),
};
const realDataset = {
  ...dataset, mode: 'real', sources: [fantasyArchive], players: [fantasyOnly],
  teams: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
};

test('uses only explicit historical votes available before the fixture and prediction time', () => {
  const options = { dataset: realDataset, asOf: predictionTime, round: 5 };
  const result = analyzePlayer(fantasyOnly, options);
  assert.equal(result.projection.method, 'fantatb-history');
  assert.deepEqual(result.projection.sample.rounds, [1, 2, 4]);
  assert.equal(result.projection.sample.asOfDate, '2026-09-20');
  assert.equal(result.projection.voteProbability, 2 / 3);
  assert.equal(result.projection.appearanceProbability, null);
  assert.equal(result.projection.expectedMinutes, null);
  assert.equal(result.expectedPoints, 5);
  assert.equal(result.index, null);
  assert.equal(analyzePlayer(fantasyOnly, { ...options, asOf: '2026-09-19' }).expectedPoints, null);
  assert.equal(analyzePlayer(fantasyOnly, { ...options, asOf: '2026-10-01' }).expectedPoints, null);
  const ambiguous = { ...realDataset, sources: [{ ...fantasyArchive, ambiguousRatings: 1 }] };
  assert.equal(analyzePlayer(fantasyOnly, { ...options, dataset: ambiguous }).expectedPoints, null);
  const additionalVote = { ...fantasyOnly, ratings: [...fantasyOnly.ratings, { round: 3, rating: 6, fantasyRating: 6 }] };
  const verified = analyzePlayer(additionalVote, { ...options, dataset: { ...ambiguous, players: [additionalVote] } });
  assert.equal(verified.projection.voteProbability, 1);
  assert.deepEqual(verified.projection.sample.rounds, [1, 3, 4]);
});

test('empirical simulation samples votes and historical scores reproducibly', () => {
  const options = { dataset: realDataset, asOf: predictionTime, round: 5, iterations: 16000, seed: 'empirical' };
  const run = simulateLineup([fantasyOnly], options);
  assert.equal(run.method, 'fantatb-history');
  assert.equal(run.coverage, 1);
  assert.deepEqual(run.methods, { 'fantatb-history': 1 });
  assert.ok(Math.abs(run.mean - 5) < 0.1);
  assert.ok(Math.abs(run.individual[0].sampledVoteProbability - 2 / 3) < 0.02);
  assert.equal(run.individual[0].sampledAppearanceProbability, null);
  assert.equal(run.min, 0);
  assert.equal(run.max, 10);
  assert.deepEqual(run, simulateLineup([fantasyOnly], options));
});

test('local league CSV takes precedence and uses only explicit current-season observations before the fixture', () => {
  const player = { ...forward, ratings: fantasyOnly.ratings };
  const sourceDataset = { ...realDataset, season: '2026/27', players: [player] };
  const row = (round, fantasyRating, season = '2026/27', teamId = 'a') => ({
    id: player.id, season, round, teamId, fantasyRating
  });
  const leagueVotes = { source: 'Regolamento della lega', rows: [
    row(1, 7), row(2, null), row(3, 0), row(4, 10, '2025/26'), row(4, 10, '2026/27', 'b'), row(5, 25)
  ] };
  const options = { dataset: sourceDataset, round: 5, asOf: predictionTime, leagueVotes };
  const result = analyzePlayer(player, options);
  assert.equal(result.projection.method, 'league-history');
  assert.deepEqual(result.projection.sample.rounds, [1, 2, 3]);
  assert.equal(result.projection.voteProbability, 2 / 3);
  assert.ok(result.index > 0);
  const simulation = simulateLineup([player], { ...options, iterations: 10000,
    leagueVotesByPlayer: new Map([[player.id,leagueVotes]]) });
  assert.equal(simulation.method, 'league-history');
  assert.ok(Math.abs(simulation.mean - 7 / 3) < 0.1);
});

test('private league samples cover local roster IDs and preserve one scoring basis per simulation', () => {
  const local = { id: 'csv:a:FWD:locale', name: 'Giocatore locale', position: 'FWD', teamId: 'a' };
  const league = { gamesWithVote: 3, fantasyAverage: 8, teamGames: 4, asOfRound: 4 };
  const options = { dataset: realDataset, asOf: predictionTime, round: 5 };
  const result = analyzePlayer(local, { ...options, fantasySample: league });
  assert.equal(result.expectedPoints, 6);
  assert.equal(result.projection.method, 'league-average');
  assert.equal(result.projection.appearanceProbability, null);
  assert.equal(analyzePlayer(local, { ...options, fantasySample: { ...league, teamGames: 5 } }).expectedPoints, null);
  assert.equal(analyzePlayer(local, { ...options, fantasySample: { ...league, asOfRound: 3 } }).expectedPoints, null);
  assert.equal(analyzePlayer(fantasyOnly, { ...options, fantasySample: league }).projection.method, 'fantatb-history');
  const earlierArchive = { ...fantasyArchive, archives: fantasyArchive.archives.filter(item => item.round < 4) };
  const earlier = { ...realDataset, sources: [earlierArchive] };
  const earlierPlayer = { ...fantasyOnly, ratings: [...fantasyOnly.ratings, { round: 3, rating: 7, fantasyRating: 6 }] };
  assert.equal(analyzePlayer(earlierPlayer, { ...options, dataset: { ...earlier, players: [earlierPlayer] }, fantasySample: league }).projection.method, 'league-average');
  const mixed = simulateLineup([fantasyOnly, local], { ...options, fantasySamples: new Map([[local.id, league]]), iterations: 5000 });
  assert.equal(mixed.method, 'league-average');
  assert.equal(mixed.coverage, 0.5);
  assert.equal(mixed.excluded[0].id, fantasyOnly.id);
  assert.match(mixed.excluded[0].reason, /base di punteggio diversa/);
  const leagueRun = simulateLineup([fantasyOnly, local], {
    ...options, fantasySamples: { [local.id]: league, [fantasyOnly.id]: league }, iterations: 5000,
  });
  assert.equal(leagueRun.method, 'league-average');
  assert.equal(leagueRun.coverage, 1);
  assert.equal(leagueRun.max, 16);
});
