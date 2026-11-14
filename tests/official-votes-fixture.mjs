import { crc32, deflateRawSync } from 'node:zlib';

export const editions = ['Fantacalcio', 'Statistico', 'Italia'];
export const season = '2026/27';
export const filename = 'Voti_Fantacalcio_Stagione_2026_27_Giornata_11.xlsx';
export const columns = ['Cod.', 'Ruolo', 'Nome', 'Voto', 'Gf', 'Gs', 'Rp', 'Rs', 'Rf', 'Au', 'Amm', 'Esp', 'Ass'];
export const teams = Array.from({ length: 20 }, (_, index) => ({
  id: 'test-' + index, name: 'Sport Club Prova ' + index, shortName: 'Prova ' + index
}));
export const players = teams.map((team, index) => ({
  id: 'test-p-' + index, name: index === 1 ? 'Aldo Di Val' : 'Giocatore prova ' + index,
  teamId: team.id, position: index % 2 ? 'FWD' : 'GK'
}));
export const listone = players.map((player, index) => ({
  id: String(index + 10), name: index === 1 ? 'Di Val A.' : player.name,
  team: teams[index].shortName, position: player.position
}));

export function makeSheets(count = 20) {
  return editions.map((name, edition) => ({
    name, rows: [
      [`Voti ${name} 11ª giornata di campionato`], ['Avviso sintetico'], ['Anche questo è sintetico'], ['Esempio di prova'],
      ...teams.slice(0, count).flatMap((team, index) => [
        [team.shortName], [...columns],
        [index + 10, index % 2 ? 'A' : 'P', listone[index].name, edition === 0 && index === 1 ? '6*' : 6 + edition / 2,
          index === 1 ? 1 : 0, index === 0 ? 3 : 0, 0, 0, index === 1 ? 1 : 0, index === 3 ? 1 : 0, 0, 0, 0],
        [index + 60, 'ALL', 'Allenatore sintetico ' + index, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      ])
    ]
  }));
}

function zip(parts) {
  const files = [];
  const directory = [];
  let offset = 0;
  for (const [path, text] of Object.entries(parts)) {
    const name = Buffer.from(path);
    const plain = Buffer.from(text);
    const data = deflateRawSync(plain);
    const crc = crc32(plain);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(name.length, 26);
    files.push(local, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(plain.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, name);
    offset += local.length + name.length + data.length;
  }
  const index = Buffer.concat(directory);
  const footer = Buffer.alloc(22);
  const count = directory.length / 2;
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(count, 8);
  footer.writeUInt16LE(count, 10);
  footer.writeUInt32LE(index.length, 12);
  footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, index, footer]);
}

const OFFICE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function makeXlsx(sheets = makeSheets()) {
  const parts = {
    'xl/workbook.xml': `<workbook xmlns="${SHEET}" xmlns:r="${OFFICE}"><sheets>${sheets.map((sheet, index) =>
      `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${PACKAGE}">${sheets.map((_, index) =>
      `<Relationship Id="rId${index + 1}" Type="${OFFICE}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`
  };
  sheets.forEach(({ rows }, index) => {
    parts[`xl/worksheets/sheet${index + 1}.xml`] = `<worksheet xmlns="${SHEET}"><sheetData>${rows.map((row, rowIndex) =>
      `<row r="${rowIndex + 1}">${row.map((value, col) => {
        const reference = String.fromCharCode(65 + col) + (rowIndex + 1);
        return typeof value === 'number' ? `<c r="${reference}"><v>${value}</v></c>`
          : `<c r="${reference}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
      }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  });
  return zip(parts);
}
