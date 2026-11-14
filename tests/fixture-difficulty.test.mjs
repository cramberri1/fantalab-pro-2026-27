import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fixtureCalendarDay } from '../js/calendar.js';
import { buildFixtureDifficulty, renderFixtureDifficulty } from '../js/fixture-difficulty.js';
import { predictMatch } from '../js/match-model.js';

const teams = [{ id: 'a', name: 'Alfa' }, { id: 'b', name: 'Beta' }];
const asOf = '2026-11-14T12:00:00+01:00';
const game = { homeId: 'a', awayId: 'b', round: 12, date: '2026-11-21', status: 'scheduled' };
const rates = { homeRate: 2, awayRate: 0.5, leagueHomeRate: 1.5, leagueAwayRate: 1, currentMatches: 80, priorMatches: 380 };

test('rates use the respective home and away league baseline and are forecast once per fixture', () => {
  let calls = 0;
  const result = buildFixtureDifficulty({ teams, fixtures: [game], rounds: [12], asOf, calendarDay: fixtureCalendarDay, predict: () => {
    calls += 1;
    return rates;
  } });
  const [home, away] = result.rows.map(row => row.cells[0]);
  assert.equal(calls, 1);
  assert.deepEqual(result.rounds, [12]);
  assert.equal(home.venue, 'Casa');
  assert.equal(home.opponent.name, 'Beta');
  assert.ok(Math.abs(home.attack - 2 / 3) < 1e-12);
  assert.equal(home.defense, 0.5);
  assert.equal(away.venue, 'Trasferta');
  assert.equal(away.attack, 1.5);
  assert.equal(away.defense, 2 / 1.5);
});

test('clips current and archived results at the as-of Italian day and forecasts at most five rounds', () => {
  const previous = { ...game, round: 11, date: '2026-11-13', status: 'played', homeGoals: 0, awayGoals: 0 };
  const sameDay = { ...previous, kickoff: '2026-11-13T23:30:00Z' };
  const future = { ...previous, date: '2026-11-15' };
  const live = { ...previous, status: 'live' };
  const result = buildFixtureDifficulty({
    teams, fixtures: [game, previous, sameDay, future, live], priorFixtures: [previous, future],
    rounds: [17, 12, 15, 12, 14, 13, 16], asOf, calendarDay: fixtureCalendarDay,
    predict(fixture, observed, archived) {
      assert.equal(fixture, game);
      assert.deepEqual(observed, [previous]);
      assert.deepEqual(archived, [previous]);
      return rates;
    }
  });
  assert.deepEqual(result.rounds, [12, 13, 14, 15, 16]);
  assert.deepEqual(result.rows[0].cells.slice(1), [null, null, null, null]);
});

test('keeps a missing forecast distinct from zero observed in an available estimate', () => {
  const fixtures = [
    game, { ...game, round: 13, date: null }, { ...game, round: 14, date: '2026-11-10' },
    { ...game, round: 15, date: '2026-12-10' }
  ];
  const result = buildFixtureDifficulty({
    teams, fixtures, rounds: [12, 13, 14, 15], asOf, calendarDay: fixtureCalendarDay,
    predict: fixture => fixture.round === 12 ? { ...rates, homeRate: 0, awayRate: 0 } : null
  });
  const cells = result.rows[0].cells;
  assert.equal(cells[0].expectedFor, 0);
  assert.equal(cells[0].defense, 0);
  assert.equal(cells[1].opponent.name, 'Beta');
  assert.equal(cells[1].attack, null);
  assert.equal(cells[2], null);
  assert.equal(cells[3].expectedFor, null);
  const markup = renderFixtureDifficulty(result, {
    html: String, number: (value, digits = 0) => Number.isFinite(value) ? value.toFixed(digits) : '—'
  });
  assert.match(markup, /Att. Alta.*0\.00/);
  assert.match(markup, /Stima mancante/);
  assert.match(markup, /Partita non disponibile/);
});

test('connects all teams to five upcoming rounds with the actual Match Center model', () => {
  const current = JSON.parse(readFileSync(new URL('../data/serie-a-2026-27.json', import.meta.url)));
  const previous = JSON.parse(readFileSync(new URL('../data/serie-a-2025-26.json', import.meta.url)));
  const result = buildFixtureDifficulty({ teams: current.teams, fixtures: current.fixtures, priorFixtures: previous.fixtures,
    rounds: [12, 13, 14, 15, 16], asOf, predict: predictMatch, calendarDay: fixtureCalendarDay });
  assert.equal(result.rows.length, 20);
  const samples = result.rows.flatMap(row => row.cells).filter(matchup => Number.isFinite(matchup?.attack));
  assert.equal(samples.length, 100);
  assert.ok(samples.every(sample => sample.currentMatches === 110 && sample.priorMatches === 380));
});
