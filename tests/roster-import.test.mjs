import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeRosterCsv, makeRosterCsvId, readRosterCsv } from '../js/roster-import.js';

const teams = [
  { id: 'valleverde', name: 'AC Valleverde', shortName: 'Valleverde', code: 'VVD' },
  { id: 'rivera', name: 'AS Rivera', shortName: 'Rivera', code: 'RIV' }
];
const players = [
  { id: 'a1', name: 'Álvaro Di Fronzo', teamId: 'valleverde', position: 'FWD' },
  { id: 'a2', name: 'G. Ferrin', teamId: 'valleverde', position: 'DEF' },
  { id: 'a3', name: 'G. Ferrín', teamId: 'rivera', position: 'GK' },
  { id: 'a4', name: 'B. Novak', teamId: 'rivera', position: 'MID' },
  { id: 'a5', name: 'C. Novak', teamId: 'rivera', position: 'MID' },
  { id: 'a6', name: 'B. Novak', teamId: 'valleverde', position: 'MID' },
  { id: 'a7', name: 'Pietro "Pino" Cassi', teamId: 'rivera', position: 'DEF' }
];
const input = { players, teams, mode: 'real' };
const fantaHeader = 'Ruolo;Nome;Squadra;Costo d\'acquisto;Quotazione Attuale;FVMp;Media Voto;Fanta Media;Partite Giocate (a voto);Prestito';
const fantacalcio = (...rows) => `\uFEFF${[fantaHeader, ...rows].join('\r\n')}`;

test('reads Fantacalcio headers, comma decimals, roles and abbreviation aliases in CSV order', () => {
  const result = readRosterCsv(fantacalcio('D;FERRIN;VVD;3;4;23;6,10;6,80;9;NO', 'A;DIFRONZO A;Valleverde;31;35;99;6,6;8,0;9;SI', 'P;FERRÍN;AS Rivera'), input);
  assert.deepEqual(result, {
    entries: [
      { id: 'a2', localId: 'csv:valleverde:DEF:ferrin' },
      { id: 'a1', localId: 'csv:valleverde:FWD:difronzoa' },
      { id: 'a3', localId: 'csv:rivera:GK:ferrin' }
    ],
    unresolved: []
  });
});

test('leaves ambiguous aliases unresolved and retains unseen or different-role players locally', () => {
  const result = readRosterCsv(fantacalcio('C;NOVAK;Rivera', 'D;MONTALVO;Rivera', 'C;G. FERRIN;Valleverde', 'D;FERRIN;Rivera', 'C;NOVAK B;Valleverde'), input);
  assert.equal(result.unresolved.length, 1);
  assert.match(result.unresolved[0].reason, /Più corrispondenze/);
  assert.deepEqual(result.entries, [
    { id: 'csv:rivera:DEF:montalvo', local: { id: 'csv:rivera:DEF:montalvo', name: 'MONTALVO', teamId: 'rivera', position: 'DEF' } },
    { id: 'csv:valleverde:MID:gferrin', local: { id: 'csv:valleverde:MID:gferrin', name: 'G. FERRIN', teamId: 'valleverde', position: 'MID' } },
    { id: 'csv:rivera:DEF:ferrin', local: { id: 'csv:rivera:DEF:ferrin', name: 'FERRIN', teamId: 'rivera', position: 'DEF' } },
    { id: 'a6', localId: 'csv:valleverde:MID:novakb' }
  ]);
});

test('requires a known club and Classic role for a Fantacalcio row', () => {
  const result = readRosterCsv(fantacalcio('Dc;MONTALVO;Rivera', 'D;MONTALVO;Inesistente', 'A;;Rivera'), input);
  assert.deepEqual(result.entries, []);
  assert.deepEqual(result.unresolved.map(row => row.reason), ['Ruolo Classic non riconosciuto', 'Squadra non riconosciuta', 'Nome mancante o troppo lungo']);
  assert.throws(() => readRosterCsv(fantacalcio('D;MONTALVO;Rivera'), { ...input, mode: 'demo' }), /Seleziona Dati reali/);
});

test('keeps generic ID and exact name imports working with quoted cells', () => {
  const result = readRosterCsv('id,nome,squadra\r\na1,,\r\n,"Pietro ""Pino"" Cassi",Rivera\r\n,Álvaro Di Fronzo,VVD\r\n,Ferrin,VVD\r\n,B. Novak,', input);
  assert.deepEqual(result.entries, [{ id: 'a1' }, { id: 'a7' }, { id: 'a1' }]);
  assert.equal(result.unresolved.length, 2);
  assert.throws(() => readRosterCsv('nome;note\n"Cassi;note', input), /virgolette non chiuse/);
});

test('decodes UTF-8 BOM and Windows-1252, and builds validated stable IDs', () => {
  assert.equal(decodeRosterCsv(new TextEncoder().encode('\uFEFFÁlvaro')), 'Álvaro');
  assert.equal(decodeRosterCsv(Uint8Array.of(0xC1, 0x6C, 0x76, 0x61, 0x72, 0x6F)), 'Álvaro');
  assert.equal(makeRosterCsvId('V. Blažíč', 'rivera', 'DEF'), 'csv:rivera:DEF:vblazic');
  assert.equal(makeRosterCsvId('!', 'rivera', 'DEF'), null);
  assert.equal(makeRosterCsvId('x'.repeat(121), 'rivera', 'DEF'), null);
  assert.equal(makeRosterCsvId('V. Blažíč', 'rivera', 'D'), null);
});
