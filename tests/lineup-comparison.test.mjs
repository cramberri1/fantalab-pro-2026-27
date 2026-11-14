import assert from 'node:assert/strict';
import test from 'node:test';
import { compareLineups } from '../js/lineup-comparison.js';

const reference = { formation: '3-4-3', starters: ['p2', 'p1'], reserves: ['p3', 'p4'], maxSubstitutions: 3 };
const current = { formation: '3-4-3', starters: ['p1', 'p2'], reserves: ['p3', 'p4'], maxSubstitutions: 1 };

function simulated(record, options = {}) {
  return {
    mean: 60, method: 'events', coverage: 1, status: 'simulated',
    individual: [
      ...record.starters.map(id => ({ id, role: 'starter' })),
      ...record.reserves.map(id => ({ id, role: 'reserve' }))
    ],
    ...options
  };
}

test('identical formations in different input order have zero difference at shared substitutions', () => {
  const calls = [];
  const result = compareLineups(reference, current, record => {
    calls.push(record);
    return simulated(record);
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].starters, ['p1', 'p2']);
  assert.equal(calls[0].maxSubstitutions, 1);
  assert.deepEqual(reference.starters, ['p2', 'p1']);
  assert.equal(result.difference, 0);
});

test('bench order changes produce separate runs with the same maximum substitutions', () => {
  const variant = { ...current, reserves: ['p4', 'p3'] };
  const calls = [];
  const result = compareLineups(reference, variant, record => {
    calls.push(record);
    return simulated(record, { mean: record.reserves[0] === 'p4' ? 61 : 60 });
  });
  assert.deepEqual(calls.map(record => record.maxSubstitutions), [1, 1]);
  assert.equal(result.difference, 1);
});

test('an incomplete reserve or a different scoring method suppresses the point difference', () => {
  const variant = { ...current, starters: ['p1', 'p5'] };
  for (const options of [{ status: 'partial' }, { method: 'fantatb-history' }]) {
    const result = compareLineups(reference, variant, record =>
      simulated(record, record.starters.includes('p5') ? options : {}));
    assert.equal(result.difference, null);
    assert.ok(result.explanation);
  }
});

test('inactive reserves are omitted from the comparison with zero substitutions', () => {
  const variant = { ...current, reserves: ['p4', 'p3'], maxSubstitutions: 0 };
  const result = compareLineups(reference, variant, record => {
    assert.deepEqual(record.reserves, []);
    return simulated(record);
  });
  assert.equal(result.difference, 0);
});
