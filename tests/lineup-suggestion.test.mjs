import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { suggestLineup } from '../js/lineup-suggestion.js';
import { analyzePlayer, FORMATION_OPTIONS, validateLineup } from '../js/model.js';

const positions = { GK: [7, 5], DEF: [6, 5, 4, 1, 0], MID: [8, 7, 6, 5, 4], FWD: [12, 10, 8, 7] };
const fixture = { id: 'upcoming' };
const roster = Object.entries(positions).flatMap(([position, points]) =>
  points.map((value, index) => ({ id: position + index, position, points: value })));
const current = {
  formation: '4-3-3', starters: ['GK1', 'DEF0', 'DEF1', 'DEF2', 'DEF3', 'MID0', 'MID1', 'MID2', 'FWD0', 'FWD1', 'FWD2'],
  reserves: [], maxSubstitutions: 2
};
const estimate = (player, method) => ({
  fixture, expectedPoints: player.points,
  projection: { method, sample: { observations: 8 } }
});
const setup = { formations: FORMATION_OPTIONS, validate: validateLineup, analyze: estimate, methods: ['events'] };

test('finds the highest-scoring XI across every formation and orders its remaining eligible bench', () => {
  const result = suggestLineup(roster, current, setup);
  assert.deepEqual(result.lineup, {
    formation: '3-4-3',
    starters: ['GK0', 'DEF0', 'DEF1', 'DEF2', 'MID0', 'MID1', 'MID2', 'MID3', 'FWD0', 'FWD1', 'FWD2'],
    reserves: ['FWD3', 'GK1', 'MID4', 'DEF3', 'DEF4'],
    maxSubstitutions: 2
  });
  assert.equal(result.expectedPoints, 78);
  assert.equal(result.currentExpectedPoints, 72);
  assert.equal(result.gain, 6);
  assert.equal(result.comparedModules, 7);
  assert.deepEqual(result.sample, { minimum: 8, maximum: 8, players: 11 });
});

test('excludes confirmed absences from XI and bench and counts them as zero in the comparison', () => {
  const result = suggestLineup(roster, current, {
    ...setup,
    analyze: (player, method) => player.id === 'FWD0'
      ? { fixture, expectedPoints: 0, unavailable: true, projection: { method: 'confirmed-out' } }
      : estimate(player, method)
  });
  assert.ok(![...result.lineup.starters, ...result.lineup.reserves].includes('FWD0'));
  assert.equal(result.eligible, roster.length - 1);
  assert.equal(result.currentExpectedPoints, 60);
  assert.equal(result.expectedPoints, 73);
  assert.equal(result.gain, 13);
});

test('uses one complete scoring basis and withholds the gain when the current XI lacks comparable data', () => {
  const result = suggestLineup(roster, current, {
    ...setup, methods: ['league-history', 'events'],
    analyze: (player, method) => method === 'league-history' && player.position === 'GK'
      ? { fixture, expectedPoints: null, projection: null }
      : player.id === 'GK1' && method === 'events'
        ? { expectedPoints: 9, projection: { method } }
        : estimate(player, method)
  });
  assert.equal(result.method, 'events');
  assert.ok(!result.lineup.reserves.includes('GK1'));
  assert.equal(result.currentExpectedPoints, null);
  assert.equal(result.gain, null);
});

test('reports incomplete coverage when no scoring basis has enough players for a valid module', () => {
  const result = suggestLineup(roster, current, {
    ...setup,
    analyze: (player, method) => player.position === 'GK'
      ? { fixture, expectedPoints: null, projection: null }
      : estimate(player, method)
  });
  assert.equal(result.lineup, null);
  assert.equal(result.expectedPoints, null);
  assert.equal(result.missingStarters, 1);
  assert.match(result.reason, /metodo di stima comune/);
});

test('uses the current module on a tie and preserves observed zero scores', () => {
  const result = suggestLineup(roster, current, {
    ...setup,
    analyze: (player, method) => estimate({ ...player, points: 0 }, method)
  });
  assert.equal(result.lineup.formation, current.formation);
  assert.equal(result.expectedPoints, 0);
  assert.equal(result.gain, 0);
});

test('builds a valid suggestion with the real simulator entry point and demo fixtures', async () => {
  const dataset = JSON.parse(await readFile(new URL('../data/demo.json', import.meta.url), 'utf8'));
  const { starters, reserves, round, formation } = dataset.demoPreset;
  const eligible = new Set([...starters, ...reserves]);
  const result = suggestLineup(dataset.players.filter(player => eligible.has(player.id)), {
    starters, reserves, formation, maxSubstitutions: 3
  }, {
    ...setup,
    analyze: (player, method) => analyzePlayer(player, { dataset, round, mode: 'demo', method })
  });
  assert.ok(result.lineup);
  assert.ok(result.gain >= -Number.EPSILON);
  assert.ok(result.sample.players === 11);
});
