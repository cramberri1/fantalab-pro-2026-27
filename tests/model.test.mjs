import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzePlayer, getPlayerFixture, simulateLineup, validateLineup } from '../js/model.js';

const now = { id: 'week5', round: 5, homeId: 'a', awayId: 'b', kickoff: '2026-09-30T18:45:00Z', status: 'scheduled' };
const fixtures = Array.from({ length: 4 }, (_, index) => ({
  id: `week${index + 1}`,
  round: index + 1,
  homeId: 'a',
  awayId: 'c',
  kickoff: `2026-09-${(index + 1) * 5}T18:45:00Z`,
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
