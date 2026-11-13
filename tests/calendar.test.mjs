import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fixtureCalendarDay, getRoundWindow, isPendingFixture } from '../js/calendar.js';

const now = new Date('2026-11-13T09:00:00Z');
const makeDataset = fixtures => ({ mode: 'real', fixtures });
const game = (round, status, date, kickoff = null) => ({ round, status, date, kickoff });

test('opens on the next round and exposes the completed round', () => {
  const real = makeDataset([
    game(11, 'played', '2026-11-08'),
    game(12, 'scheduled', '2026-11-21')
  ]);
  assert.deepEqual(getRoundWindow(real, now), {
    next: 12, latest: 11, nextStarted: false, latestComplete: true, defaultRound: 12
  });
});

test('uses Italian local dates and avoids offering an elapsed kickoff', () => {
  const midnight = game(12, 'scheduled', '2026-11-12', '2026-11-12T23:30:00Z');
  assert.equal(fixtureCalendarDay(midnight), '2026-11-13');
  assert.equal(isPendingFixture(midnight, now), false);
  assert.equal(isPendingFixture(game(12, 'scheduled', '2026-11-13'), now), true);
  assert.equal(isPendingFixture(game(12, 'postponed', '2026-11-14'), now), false);
  assert.equal(isPendingFixture(game(12, 'unknown', '2026-11-14'), now), false);
});

test('retains a live or partly played round while displaying the previous round', () => {
  const data = makeDataset([
    game(11, 'played', '2026-11-08'),
    game(12, 'played', '2026-11-12'),
    game(12, 'live', '2026-11-13', '2026-11-13T08:45:00Z'),
    game(13, 'scheduled', '2026-11-20')
  ]);
  assert.deepEqual(getRoundWindow(data, now), {
    next: 12, latest: 11, nextStarted: true, latestComplete: true, defaultRound: 12
  });
});

test('skips an older catch-up match and marks an incomplete historical round accurately', () => {
  const data = makeDataset([
    game(10, 'scheduled', '2026-11-14'),
    game(11, 'played', '2026-11-08'),
    game(11, 'unknown', '2026-11-08'),
    game(12, 'scheduled', '2026-11-21')
  ]);
  assert.deepEqual(getRoundWindow(data, now), {
    next: 12, latest: 11, nextStarted: false, latestComplete: false, defaultRound: 12
  });
});

test('selects the closest upcoming kickoff and falls back to the last completed round', () => {
  const completed = game(11, 'played', '2026-11-08');
  const data = makeDataset([completed, game(12, 'scheduled', null), game(13, 'scheduled', '2026-11-15')]);
  assert.equal(getRoundWindow(data, now).defaultRound, 13);
  assert.deepEqual(getRoundWindow(makeDataset([completed]), now), {
    next: null, latest: 11, nextStarted: false, latestComplete: true, defaultRound: 11
  });
});

test('keeps the demo formation on the preset round even after the synthetic dates have passed', () => {
  const demo = JSON.parse(readFileSync(new URL('../data/demo.json', import.meta.url), 'utf8'));
  const calendar = getRoundWindow(demo, new Date('2030-01-01T12:00:00Z'));
  assert.equal(calendar.defaultRound, demo.demoPreset.round);
  assert.equal(calendar.latest, 10);
});
