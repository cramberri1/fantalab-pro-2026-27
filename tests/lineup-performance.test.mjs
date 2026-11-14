import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateLineupPerformance } from '../js/lineup-performance.js';

const makePlayer = (id, position, expectedPoints = null) => ({ id, name: id, position, expectedPoints });
const forecast = {
  season: '2026/27', round: 7, asOf: '2026-10-16T09:00:00Z',
  starters: [makePlayer('a', 'GK', 4), makePlayer('b', 'FWD', 7), makePlayer('c', 'FWD', 2)],
  reserves: [makePlayer('wrong-role', 'MID'), makePlayer('first', 'FWD', 1), makePlayer('second', 'FWD', 1)],
  maxSubstitutions: 1, expectedPoints: 13, coverage: 1, method: 'fantatb-history'
};
function votes(entries, source = 'TransferBeat', sourceId = 'transferbeat-ratings') {
  return (player, round, season) => {
    assert.equal(round, 7);
    assert.equal(season, '2026/27');
    return Object.hasOwn(entries, player.id) ? { fantasyRating: entries[player.id], source, sourceId } : undefined;
  };
}

test('uses same-role reserves in order up to the limit and preserves a real zero vote', () => {
  const result = evaluateLineupPerformance(forecast, votes({
    a: 0, b: null, c: null, 'wrong-role': 12, first: 6, second: 10
  }));
  assert.equal(result.actualPoints, 6);
  assert.equal(result.difference, -7);
  assert.equal(result.source, 'TransferBeat');
  assert.equal(result.substitutions, 1);
  assert.deepEqual(result.coverage, { known: 3, total: 3 });
  assert.equal(result.rows[0].creditedPoints, 0);
  assert.equal(result.rows[1].replacementId, 'first');
  assert.equal(result.rows[3].use, 'bench');
  assert.equal(result.rows[4].use, 'substitute');
});

test('does not jump over an unreported reserve with priority and keeps the partial subtotal separate', () => {
  const result = evaluateLineupPerformance(forecast, votes({ a: 7, b: null, c: 6, second: 9 }));
  assert.equal(result.actualPoints, null);
  assert.equal(result.observedPoints, 13);
  assert.equal(result.difference, null);
  assert.deepEqual(result.coverage, { known: 2, total: 3 });
  assert.equal(result.rows[1].use, 'unresolved');
  assert.equal(result.rows[4].use, 'unresolved');
});

test('an absent starter vote is unresolved while explicit SV without an available reserve settles at zero', () => {
  const absent = evaluateLineupPerformance(forecast, votes({ a: 7, c: 6, first: 6, second: 9 }));
  assert.equal(absent.actualPoints, null);
  assert.equal(absent.rows[1].recorded, false);
  const explicit = evaluateLineupPerformance({ ...forecast, reserves: [] }, votes({ a: 7, b: null, c: 6 }));
  assert.equal(explicit.actualPoints, 13);
  assert.equal(explicit.rows[1].use, 'no-vote');
  assert.equal(explicit.rows[1].recorded, true);
});

test('keeps published and local bases separate and excludes partial projections from the delta', () => {
  const local = votes({ a: 6, b: 7, c: 7 }, 'Mia lega', 'my-league');
  const distinct = evaluateLineupPerformance(forecast, local);
  assert.equal(distinct.actualPoints, 20);
  assert.equal(distinct.difference, null);
  const same = { ...forecast, method: 'league-history', source: 'Mia lega', sourceId: 'my-league' };
  assert.equal(evaluateLineupPerformance(same, local).difference, 7);
  assert.equal(evaluateLineupPerformance({ ...same, coverage: 0.8 }, local).difference, null);
  assert.equal(evaluateLineupPerformance({ ...same, complete: false }, local).difference, null);
  const mixed = evaluateLineupPerformance(forecast, (player, ...args) =>
    player.id === 'a' ? { fantasyRating: 5, source: 'TransferBeat' } : local(player, ...args));
  assert.equal(mixed.actualPoints, null);
  assert.match(mixed.reason, /fonti diverse/);
});
