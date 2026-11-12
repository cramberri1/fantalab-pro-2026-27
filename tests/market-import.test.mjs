import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarketRows, readMarketWorkbook } from '../js/market-import.js';

const header = ['#', 'Nome', 'Fuori lista', 'Sq.', 'Under', 'R.', 'R.MANTRA', 'PGv', 'MV', 'FM', 'FVM/1000', 'QUOT.', 'FantaSquadra', 'Costo'];

test('reads Fantacalcio column labels, decimal values and separate credit measures', () => {
  const values = ['7201', 'Atleta Alfa', '', 'Aurora', '23', 'D', 'Dc/B', '10', '6,45', '7.10', 85, 19, 'Squadra Demo', '0'];
  const result = parseMarketRows([['Report Classic'], header, values]);
  assert.deepEqual(result, {
    skipped: 0,
    rows: [{
      id: '7201', name: 'Atleta Alfa', team: 'Aurora', position: 'DEF',
      mantra: 'Dc/B', offList: false, under: 23, appearances: 10, averageRating: 6.45,
      fantasyAverage: 7.1, fvm: 85, price: 19, fantasyTeam: 'Squadra Demo', cost: 0
    }]
  });
});

test('distinguishes off-list players, blank costs and zero appearances from real ratings', () => {
  const result = parseMarketRows([header, [7202, 'Atleta Beta', '*', 'Aurora', 20, 'P', 'Por', 0, 0, 0, 8, 1]]);
  const player = result.rows[0];
  assert.equal(player.position, 'GK');
  assert.equal(player.offList, true);
  assert.equal(player.appearances, 0);
  assert.equal(player.averageRating, null);
  assert.equal(player.fantasyAverage, null);
  assert.equal(player.cost, null);
  assert.equal(player.fantasyTeam, null);
});

test('counts invalid rows, keeps an empty valid free list, and rejects conflicting IDs', () => {
  const unknownRole = [7203, 'Atleta Gamma', '', 'Aurora', 24, 'X'];
  const validPlayer = [7204, 'Atleta Delta', '', 'Aurora', 28, 'C'];
  assert.deepEqual(parseMarketRows([header, [], unknownRole]), { rows: [], skipped: 1 });
  assert.deepEqual(parseMarketRows([header]), { rows: [], skipped: 0 });
  assert.throws(() => parseMarketRows([header, validPlayer, validPlayer]), /duplicati/);
  assert.equal(parseMarketRows([['Nome', 'Squadra']]), null);
});

test('rejects invalid archives before examining any worksheet', async () => {
  await assert.rejects(readMarketWorkbook(new Uint8Array(32)), /archivio XLSX valido/);
});
