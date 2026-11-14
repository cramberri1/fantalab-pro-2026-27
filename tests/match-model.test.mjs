import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { backtestMatches, predictMatch, predictMatchRates } from '../js/match-model.js';

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
  const emptyMetrics = { brier: null, logLoss: null, goalDeviance: null };
  assert.deepEqual(backtestMatches([completed]), {
    matches: 0, excluded: 1, dixonColesMatches: 0, selectedModel: 'poisson',
    model: { brier: null, logLoss: null }, baseline: { brier: null, logLoss: null },
    dixonColes: { brier: null, logLoss: null }, replay: { ...emptyMetrics, dixonColesMatches: 0 },
    goalCalibration: { applied: false, multiplier: 1, candidateMultiplier: null, learningMatches: 0, evaluatedMatches: 0, evaluatedDays: 0,
      replayAppliedMatches: 0, fixed: emptyMetrics, adaptive: emptyMetrics, unscaledReplay: emptyMetrics }
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

test('replays the deployed selection and keeps decisions fixed across the threshold day', () => {
  const sameDay = { ...draw, date: drawCurrent.at(-1).date, homeId: 'gamma' };
  const nextDay = { ...draw, date: isoDay('2026-07-01', 50) };
  const games = [...drawCurrent, sameDay, nextDay];
  const report = backtestMatches(games, drawPrior);
  const replayed = games.map(game => predictMatch(game, games, drawPrior));
  assert.deepEqual(replayed.slice(-3).map(prediction => prediction.model), ['poisson', 'poisson', 'dixon-coles']);
  assert.equal(report.replay.dixonColesMatches, 1);
  const brier = replayed.reduce((sum, { probabilities: [home, draw, away] }) => sum + home ** 2 + (1 - draw) ** 2 + away ** 2, 0);
  const logLoss = -replayed.reduce((sum, { probabilities }) => sum + Math.log(probabilities[1]), 0);
  assert.ok(Math.abs(report.replay.brier - brier / games.length) < 1e-12);
  assert.ok(Math.abs(report.replay.logLoss - logLoss / games.length) < 1e-12);
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

const highScoringPrior = Array.from({ length: 100 }, (_, index) => ({
  ...draw, date: isoDay('2025-09-01', index), homeGoals: 4, awayGoals: 1
}));
const lowScoringSeason = Array.from({ length: 70 }, (_, index) => ({ ...draw, date: isoDay('2026-07-01', index) }));
const calibrationTarget = { ...target, date: '2026-10-01' };

test('learns a bounded goal correction and applies it only after a walk-forward holdout', () => {
  const warmup = predictMatch(calibrationTarget, lowScoringSeason.slice(0, 29), highScoringPrior).goalCalibration;
  assert.equal(warmup.candidateMultiplier, null);
  const tooFew = predictMatch(calibrationTarget, lowScoringSeason.slice(0, 59), highScoringPrior).goalCalibration;
  assert.equal(tooFew.candidateMultiplier, 0.8);
  assert.equal(tooFew.evaluatedMatches, 29);
  assert.equal(tooFew.applied, false);

  const singleDay = [...lowScoringSeason.slice(0, 30), ...lowScoringSeason.slice(30, 60).map(fixture =>
    ({ ...fixture, date: lowScoringSeason[30].date }))];
  const concentrated = backtestMatches(singleDay, highScoringPrior).goalCalibration;
  assert.equal(concentrated.evaluatedMatches, 30);
  assert.equal(concentrated.evaluatedDays, 1);
  assert.ok(concentrated.adaptive.goalDeviance < concentrated.fixed.goalDeviance);
  assert.equal(concentrated.applied, false);

  const newTeams = { ...calibrationTarget, homeId: 'gamma', awayId: 'delta' };
  const raw = predictMatchRates(newTeams, lowScoringSeason, highScoringPrior);
  const adjusted = predictMatch(newTeams, lowScoringSeason, highScoringPrior);
  const report = backtestMatches(lowScoringSeason, highScoringPrior);
  assert.equal(adjusted.goalCalibration.applied, true);
  assert.equal(adjusted.goalCalibration.multiplier, 0.8);
  assert.ok(adjusted.homeRate + adjusted.awayRate < raw.homeRate + raw.awayRate);
  assert.equal(report.goalCalibration.replayAppliedMatches, 10);
  assert.ok(report.goalCalibration.adaptive.goalDeviance < report.goalCalibration.fixed.goalDeviance);
});

test('rejects a goal adjustment that improves goal deviance but damages 1X2 probabilities', () => {
  const transition = lowScoringSeason.slice(0, 60).map((fixture, index) =>
    index < 30 ? fixture : { ...fixture, homeGoals: 5 });
  const report = backtestMatches(transition, highScoringPrior);
  const { goalCalibration } = report;
  assert.equal(goalCalibration.evaluatedMatches, 30);
  assert.equal(goalCalibration.candidateMultiplier, 1.2);
  assert.ok(goalCalibration.adaptive.goalDeviance < goalCalibration.fixed.goalDeviance);
  assert.ok(goalCalibration.adaptive.logLoss > goalCalibration.fixed.logLoss);
  assert.equal(goalCalibration.applied, false);
  assert.equal(goalCalibration.multiplier, 1);
});

test('ignores same-day and future games in the active goal adjustment and faithfully replays it', () => {
  const forecast = predictMatch(calibrationTarget, lowScoringSeason, highScoringPrior);
  const extra = [{ ...draw, kickoff: '2026-09-30T22:15:00Z', homeGoals: 8, awayGoals: 8 },
    { ...draw, date: '2026-10-02', homeGoals: 8, awayGoals: 8 }];
  assert.equal(forecast.goalCalibration.applied, true);
  assert.deepEqual(predictMatch(calibrationTarget, [...lowScoringSeason, ...extra], highScoringPrior), forecast);

  const predictions = lowScoringSeason.map(fixture => predictMatch(fixture, lowScoringSeason, highScoringPrior));
  const report = backtestMatches(lowScoringSeason, highScoringPrior);
  const logLoss = -predictions.reduce((sum, { probabilities }) => sum + Math.log(probabilities[1]), 0);
  assert.equal(report.goalCalibration.replayAppliedMatches,
    predictions.filter(({ goalCalibration }) => goalCalibration.applied).length);
  assert.ok(Math.abs(report.replay.logLoss - logLoss / lowScoringSeason.length) < 1e-12);
});
