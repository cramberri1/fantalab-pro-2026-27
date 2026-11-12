import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMarket, compareMarketTrade, rankMarketReplacements } from '../js/market.js';

const teams = [
  { id: 'verde', name: 'FC Verde', shortName: 'Verde', code: 'VER' },
  { id: 'blu', name: 'AC Blu', shortName: 'Blu', code: 'BLU' }
];
const roster = [{ id: 'held', name: 'E. Marini', teamId: 'verde', position: 'DEF' }];
const dataset = { mode: 'real', teams, players: roster };
const record = (id, extra = {}) => ({
  id: String(id), name: 'Calciatore ' + id, position: 'DEF', team: 'Verde', offList: false,
  appearances: 6, fantasyAverage: 6, averageRating: 6, price: 7, fvm: 20, ...extra
});
const held = record(1, { name: 'Marini E.', fantasyTeam: 'La mia squadra' });
const regular = record(2, { appearances: 10, fantasyAverage: 7, price: 3 });

test('uses only listed, active, unowned league free agents and reports workbook conflicts', () => {
  const offList = record(3, { offList: true });
  const owned = record(4, { fantasyTeam: 'Altra squadra' });
  const wrongClub = record(5, { team: 'Blu' });
  const market = buildMarket({
    listone: [held, regular, offList, owned, wrongClub, record(6)],
    freeAgents: [regular, offList, { ...owned, fantasyTeam: null }, { ...wrongClub, team: 'Verde' }],
    roster, dataset
  });
  assert.deepEqual(market.freeAgents.map(profile => profile.workbookId), ['2']);
  assert.equal(market.roster[0].workbookId, '1');
  assert.equal(market.coverage.matchedRoster, 1);
  assert.equal(market.coverage.offListFreeAgents, 1);
  assert.equal(market.coverage.conflictingFreeAgents, 2);
  assert.equal(market.catalog.find(profile => profile.workbookId === '6').availability, 'unconfirmed');
});

test('marks a zero-vote average missing, weights small samples and applies a reference-price cap', () => {
  const zero = record(3, { appearances: 0, fantasyAverage: 0, price: 0 });
  const one = record(4, { appearances: 1, fantasyAverage: 10, price: 2 });
  const unknownPrice = record(5, { price: null });
  const market = buildMarket({
    listone: [held, regular, zero, one, unknownPrice],
    freeAgents: [regular, zero, one, unknownPrice],
    roster, dataset
  });
  const zeroProfile = market.catalog.find(profile => profile.workbookId === '3');
  const oneProfile = market.catalog.find(profile => profile.workbookId === '4');
  assert.equal(zeroProfile.fantasyAverage, null);
  assert.equal(zeroProfile.score, null);
  assert.equal(zeroProfile.components.volume, 0);
  assert.ok(oneProfile.adjustedFantasy < 8);
  assert.equal(market.coverage.observedMax, 10);
  const unrestricted = rankMarketReplacements(market, 'roster:held');
  assert.equal(unrestricted.candidates[0].signal, 'upgrade');
  assert.equal(unrestricted.candidates.find(result => result.incoming.workbookId === '4').signal, 'limited');
  const capped = rankMarketReplacements(market, 'roster:held', { maxReferencePrice: 0 });
  assert.deepEqual(capped.candidates.map(result => result.incoming.workbookId), ['3']);
  assert.deepEqual(capped.excluded, { unknownPrice: 1, overBudget: 2, unscored: 1 });
});

test('keeps ambiguous same-role links out of replacements and does not borrow public appearances', () => {
  const otherRoster = [{ id: 'same', name: 'Verdi', teamId: 'verde', position: 'DEF', appearances: 8 }];
  const examples = [record(1, { name: 'Paolo Verdi' }), record(2, { name: 'Luca Verdi' }),
    record(3, { name: 'Marco Verdi', team: 'Blu' }), record(4, { name: 'Mario Verdi', position: 'MID' })];
  const market = buildMarket({ listone: examples, freeAgents: examples, roster: otherRoster, dataset });
  assert.equal(market.roster[0].resolution, 'ambiguous');
  assert.equal(market.roster[0].appearances, null);
  assert.deepEqual(market.freeAgents.map(profile => profile.workbookId), ['3','4']);
});

test('checks manual same-role trades and preserves signed credits without affecting the index', () => {
  const owned = record(3, { fantasyTeam: 'Altra squadra', fantasyAverage: 7, appearances: 10 });
  const otherRole = record(4, { fantasyTeam: 'Altra squadra', position: 'MID' });
  const ownTeam = record(5, { fantasyTeam: 'La mia squadra' });
  const market = buildMarket({ listone: [held, regular, owned, otherRole, ownTeam], freeAgents: [regular], roster, dataset });
  const trade = compareMarketTrade(market, 'roster:held', 'fc:3', { creditDifference: -4 });
  assert.equal(trade.ok, true);
  assert.equal(trade.creditDifference, -4);
  assert.equal(trade.delta.score, compareMarketTrade(market, 'roster:held', 'fc:3').delta.score);
  assert.equal(compareMarketTrade(market, 'roster:held', 'fc:4').ok, false);
  assert.equal(compareMarketTrade(market, 'roster:held', 'fc:5').ok, false);
  assert.equal(compareMarketTrade(market, 'roster:held', 'fc:2').ok, false);
});

test('keeps a confirmed zero fixture projection separate from the historical score', () => {
  const match = { id: 'game' };
  const options = { listone: [held, regular], freeAgents: [regular], roster, dataset };
  const baseline = buildMarket(options);
  const market = buildMarket({
    ...options,
    analyze: () => ({ fixture: match, expectedPoints: 0, availability: { status: 'out' } })
  });
  assert.equal(market.roster[0].expectedPoints, 0);
  assert.equal(market.roster[0].absenceStatus, 'out');
  assert.equal(market.roster[0].score, baseline.roster[0].score);
  assert.equal(market.coverage.fixtureProjections, 1);
});
