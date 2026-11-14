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
    matches: 0, excluded: 1, dixonColesMatches: 0, selectedModel: 'poisson',
    model: { brier: null, logLoss: null }, baseline: { brier: null, logLoss: null },
    dixonColes: { brier: null, logLoss: null }
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
  assert.ok(result.dixonColesMatches > 0);
  assert.ok(result.dixonColes.brier >= 0 && result.dixonColes.brier <= 2);
  assert.ok(result.dixonColes.logLoss >= 0);
});

const isoDay = (start, index) => new Date(Date.parse(start) + index * 86_400_000).toISOString().slice(0, 10);
const draw = { homeId: 'alpha', awayId: 'beta', status: 'played', homeGoals: 0, awayGoals: 0 };
const drawPrior = Array.from({ length: 68 }, (_, index) => ({ ...draw, date: isoDay('2026-01-01', index) }));
const drawCurrent = Array.from({ length: 50 }, (_, index) => ({ ...draw, date: isoDay('2026-07-01', index) }));
const drawTarget = { ...target, date: '2026-08-20' };

test('requires enough prior evaluation and both metric improvements to choose Dixon–Coles', () => {
  const report = backtestMatches(drawCurrent, drawPrior);
  assert.equal(report.dixonColesMatches, 50);
  assert.ok(report.dixonColes.brier < report.model.brier);
  assert.ok(report.dixonColes.logLoss < report.model.logLoss);
  assert.equal(report.selectedModel, 'dixon-coles');
  const beforeEvidence = predictMatch(drawTarget, drawCurrent.slice(0, -1), drawPrior);
  assert.equal(beforeEvidence.model, 'poisson');
  assert.equal(beforeEvidence.rho, null);
  const afterEvidence = predictMatch(drawTarget, drawCurrent, drawPrior);
  assert.equal(afterEvidence.model, 'dixon-coles');
  assert.equal(afterEvidence.selectionMatches, 50);
  assert.ok(afterEvidence.rho < 0);
  assert.ok(afterEvidence.probabilities[1] > beforeEvidence.probabilities[1]);
  assert.ok(afterEvidence.probabilities.every(value => value > 0));
  assert.ok(Math.abs(afterEvidence.probabilities.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
});

test('fit and model selection ignore later matches and all results on the Italian kickoff day', () => {
  const prediction = predictMatch(drawTarget, drawCurrent, drawPrior);
  const extras = [
    { ...draw, date: '2026-08-20', homeGoals: 4 },
    { ...draw, kickoff: '2026-08-19T22:30:00Z', homeGoals: 6 },
    { ...draw, date: '2026-08-21', awayGoals: 8 }
  ];
  assert.deepEqual(predictMatch(drawTarget, [...extras, ...drawCurrent], drawPrior), prediction);
  assert.deepEqual(predictMatch(drawTarget, drawCurrent, [...drawPrior, ...extras]), prediction);
});

test('keeps the existing Poisson prediction when the calibrated correction performs worse', () => {
  const decisive = Array.from({ length: 50 }, () => ({ ...draw, date: '2026-08-19', homeGoals: 2 }));
  const report = backtestMatches(decisive, drawPrior);
  assert.equal(report.dixonColesMatches, 50);
  assert.ok(report.dixonColes.logLoss > report.model.logLoss);
  assert.equal(report.selectedModel, 'poisson');
  const result = predictMatch(drawTarget, decisive, drawPrior);
  assert.equal(result.model, 'poisson');
  assert.equal(result.rho, null);
});
