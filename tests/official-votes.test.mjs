import assert from 'node:assert/strict';
import test from 'node:test';
import { makeSheets, makeXlsx, teams, players, listone, filename, season } from './official-votes-fixture.mjs';
import { bindOfficialVoteRows, officialVotesSeason, parseOfficialVoteSheets, readOfficialVotesWorkbook } from '../js/official-votes.js';

const context = { season, teams, players, listone };
const parse = sheets => parseOfficialVoteSheets(sheets, context);
const mapRows = (sheets, edit) => sheets.map(sheet => ({ ...sheet, rows: edit(sheet.rows) }));

test('reads all three editions, coaches, asterisks, zero events and corroborated codes', () => {
  const result = parse(makeSheets());
  assert.equal(result.round, 11);
  assert.equal(result.complete, true);
  assert.equal(result.readRows, 20);
  assert.equal(result.ignoredCoaches, 20);
  assert.equal(result.codeCoverage, 1);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.unmatched.length, 0);
  const striker = result.rows.at(1);
  assert.equal(striker.id, players[1].id);
  assert.deepEqual(striker.votes, { Fantacalcio: [6, true], Statistico: [6.5, false], Italia: [7, false] });
  assert.equal(striker.events.penaltyScored, 1);
  assert.equal(striker.events.penaltyMissed, 0);
});

test('checks season and refuses reading an unconfirmed or invalid archive', async () => {
  assert.equal(officialVotesSeason(filename), season);
  assert.equal(officialVotesSeason('Voti_Stagione_2025_26.xlsx'), '2025/26');
  assert.equal(officialVotesSeason('Voti_Stagione_2026_2042.xlsx'), null);
  await assert.rejects(readOfficialVotesWorkbook(makeXlsx(), { ...context, filename: 'Voti.xlsx' }), { code: 'SEASON_CONFIRMATION', detectedSeason: null });
  await assert.rejects(readOfficialVotesWorkbook(makeXlsx(), { ...context, filename: 'Voti_Stagione_2025_26.xlsx' }), { code: 'SEASON_CONFIRMATION', detectedSeason: '2025/26' });
  await assert.rejects(readOfficialVotesWorkbook(new Uint8Array(32), { ...context, filename: 'Voti.xlsx', confirmedSeason: season }), /archivio XLSX valido/);
});

test('rejects missing or duplicate sheets and duplicate codes', () => {
  const sheets = makeSheets();
  assert.throws(() => parse(sheets.slice(0, 2)), /Fogli voto mancanti.*Italia/);
  assert.throws(() => parse([...sheets, sheets[0]]), /Foglio duplicato/);
  sheets[0].rows.splice(7, 0, [...sheets[0].rows[6]]);
  assert.throws(() => parse(sheets), /Codice calciatore duplicato/);
});

test('retains a partial day and skips unknown team blocks with a warning', () => {
  const result = parse(mapRows(makeSheets(3), rows => rows.map((row, index) => index === 12 ? ['Club sconosciuto'] : row)));
  assert.equal(result.complete, false);
  assert.equal(result.readRows, 3);
  assert.deepEqual(result.teamIds, ['test-0', 'test-1']);
  assert.equal(result.rows.length, 2);
  assert.equal(result.codeCoverage, 2 / 3);
  assert.match(result.warnings[0], /squadra non riconosciuta/);
});

test('warns on unbalanced full-day goals and validates event and title structure', () => {
  const modified = mapRows(makeSheets(), rows => rows.map((row, index) => index === 6
    ? row.map((value, col) => col === 5 ? 1 : value) : row));
  assert.match(parse(modified).warnings[0], /Gf \+ Rf \+ Au = 3, Gs dei portieri = 1/);
  const invalid = makeSheets();
  invalid[0].rows[5] = ['Cod.', 'Nome', 'Squadra'];
  assert.throws(() => parse(invalid), /Intestazioni dei voti non riconosciute/);
  invalid[0].rows[0] = ['Voti di campionato'];
  assert.throws(() => parse(invalid), /Giornata non riconosciuta/);
  const conflict = makeSheets();
  conflict[0].rows[6][4] = 4;
  assert.throws(() => parse(conflict), /gli eventi differiscono/);
  conflict[0].rows[6][4] = '-1';
  assert.throws(() => parse(conflict), /Voto o evento non valido/);
});

test('keeps homonyms and multiple codes for the same player unresolved', () => {
  const result = parseOfficialVoteSheets(makeSheets(), { ...context, players: [...players, { ...players[1], id: 'omocognome' }] });
  assert.equal(result.rows[1].id, null);
  assert.equal(result.unmatched[0].ambiguous, true);
  assert.equal(result.unmatched[0].position, 'FWD');
  assert.deepEqual(result.unmatched[0].candidateIds, ['test-p-1', 'omocognome']);
  const conflicting = bindOfficialVoteRows([result.rows[1], { ...result.rows[1], code: '9000' }], context);
  assert.equal(conflicting.rows.filter(row => row.id).length, 0);
  assert.equal(conflicting.unmatched.length, 2);
});

test('only uses workbook codes when at least 95% match their identity', () => {
  const { rows } = parse(makeSheets());
  const withHomonym = [...players, { ...players[1], id: 'omocognome' }].map(player =>
    player.id === players[1].id ? { ...player, workbookId: listone[1].id } : player);
  const incorrect = code => ({ ...listone[code], team: 'Club estraneo' });
  const below = bindOfficialVoteRows(rows, { teams, players: withHomonym, listone: [incorrect(0), ...listone.slice(1, -1), incorrect(19)] });
  assert.equal(below.codeCoverage, 0.9);
  assert.equal(below.rows[1].id, null);
  const enough = bindOfficialVoteRows(rows, { teams, players: withHomonym, listone: [incorrect(0), ...listone.slice(1)] });
  assert.equal(enough.codeCoverage, 0.95);
  assert.equal(enough.rows[1].id, players[1].id);
});
