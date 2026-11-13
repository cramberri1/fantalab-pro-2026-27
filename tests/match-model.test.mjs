import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { backtestMatches, predictMatch } from '../js/match-model.js';

const prior = Array.from({ length: 12 }, () => ({
  date: '2026-05-20', homeId: 'alpha', awayId: 'beta', homeGoals: 2, awayGoals: 1
}));
const target = { date: '2026-08-24', homeId: 'alpha', awayId: 'beta', status: 'scheduled' };
const completed = { ...target, status: 'played', homeGoals: 0, awayGoals: 1 };

test('uses venue-specific records and shrinks a club with no past fixtures towards the league', () => {
  const result = predictMatch(target, [], prior);
  const newcomer = predictMatch({ ...target, homeId: 'new' }, [], prior);
  assert.equal(result.priorMatches, 12);
  assert.deepEqual(result.home, { priorMatches: 12, currentMatches: 0 });
  assert.deepEqual(newcomer.home, { priorMatches: 0, currentMatches: 0 });
  assert.ok(Math.abs(result.probabilities.reduce((sum, p) => sum + p, 0) - 1) < 1e-12);
  const earlier = { ...completed, date: '2026-08-23', homeGoals: 5 };
  const reversed = { ...earlier, homeId: 'beta', awayId: 'alpha' };
  assert.ok(predictMatch(target, [earlier], prior).homeRate > predictMatch(target, [reversed], prior).homeRate);
});

test('excludes future and same-day results in Italy and ignores non-final scores', () => {
  const sameDay = { ...completed, date: '2026-08-23', kickoff: '2026-08-23T22:15:00Z', homeGoals: 20 };
  const future = { ...completed, date: '2026-08-25', awayGoals: 20 };
  const live = { ...completed, date: '2026-08-23', status: 'live', homeGoals: 20 };
  const badScore = { ...completed, date: '2026-08-23', homeGoals: null };
  assert.deepEqual(predictMatch(target, [sameDay, future, live, badScore], prior), predictMatch(target, [], prior));
  assert.equal(predictMatch(target, [], [...prior, future]).priorMatches, 12);
  assert.equal(predictMatch({ ...target, date: null }, [], prior), null);
});

test('requires enough prior results to score a fixture with or without an archive', () => {
  assert.equal(predictMatch(target, [], prior.slice(0, 11)), null);
  const current = prior.map(row => ({ ...row, status: 'played' }));
  assert.equal(predictMatch(target, current.slice(0, 11)), null);
  const result = predictMatch(target, current);
  assert.equal(result.priorMatches, 0);
  assert.equal(result.currentMatches, 12);
  assert.deepEqual(backtestMatches([completed]), {
    matches: 0, excluded: 1, model: { brier: null, logLoss: null }, baseline: { brier: null, logLoss: null }
  });
});

test('backtest uses exactly the prediction before the match and reports unusable finals', () => {
  const prediction = predictMatch(completed, [], prior);
  const result = backtestMatches([completed, { ...completed, awayGoals: null }], prior);
  const p = prediction.probabilities;
  assert.equal(result.matches, 1);
  assert.equal(result.excluded, 1);
  assert.equal(result.model.logLoss, -Math.log(p[2]));
  assert.equal(result.model.brier, p[0] ** 2 + p[1] ** 2 + (p[2] - 1) ** 2);
  assert.equal(result.baseline.logLoss, -Math.log(prediction.baseline[2]));
});

test('evaluates the real snapshot against the same-date league baseline', () => {
  const current = JSON.parse(readFileSync(new URL('../data/serie-a-2026-27.json', import.meta.url)));
  const previous = JSON.parse(readFileSync(new URL('../data/serie-a-2025-26.json', import.meta.url)));
  const result = backtestMatches(current.fixtures, previous.fixtures);
  assert.equal(result.matches, current.fixtures.filter(row => row.status === 'played').length);
  assert.equal(result.excluded, 0);
  assert.ok(result.model.brier >= 0 && result.model.brier <= 2);
  assert.ok(result.model.logLoss >= 0);
  assert.ok(result.baseline.brier >= 0 && result.baseline.brier <= 2);
  assert.ok(result.baseline.logLoss >= 0);
});
