const CLASSIC_ROLE = { P: 'GK', D: 'DEF', C: 'MID', A: 'FWD' };
const COLUMNS = {
  '#': 'id', nome: 'name', 'fuori lista': 'offList', sq: 'team', under: 'under',
  r: 'position', 'r mantra': 'mantra', pgv: 'appearances', mv: 'averageRating',
  fm: 'fantasyAverage', 'fvm 1000': 'fvm', quot: 'price', fantasquadra: 'fantasyTeam',
  costo: 'cost'
};
const REQUIRED_COLUMNS = ['id', 'name', 'team', 'position', 'appearances', 'fantasyAverage'];
const MAX_WORKBOOK = 12 * 1024 * 1024;
const MAX_PART = 8 * 1024 * 1024;
const MAX_EXPANDED = 24 * 1024 * 1024;
const MAX_ROWS = 10000;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

function text(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function key(value) {
  const label = text(value);
  if (label === '#') return label;
  return label.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function metric(value) {
  const raw = text(value);
  if (!/^\d+(?:[.,]\d+)?$/.test(raw)) return null;
  const number = Number(raw.replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function shortText(value) {
  const label = text(value);
  return label.length > 150 ? '' : label;
}

function columnsFor(row) {
  const columns = new Map();
  row.forEach((cell, index) => {
    const label = key(cell);
    if (Object.hasOwn(COLUMNS, label)) columns.set(COLUMNS[label], index);
  });
  return columns;
}

export function parseMarketRows(rows) {
  let columns;
  const headerIndex = rows.slice(0, 15).findIndex(row => {
    columns = columnsFor(row);
    return REQUIRED_COLUMNS.every(column => columns.has(column));
  });
  if (headerIndex < 0) return null;
  const parsed = [];
  const ids = new Set();
  let skipped = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    if (!row.some(cell => text(cell) !== '')) continue;
    const cell = column => row[columns.get(column)];
    const id = metric(cell('id'));
    const name = shortText(cell('name'));
    const team = shortText(cell('team'));
    const position = CLASSIC_ROLE[text(cell('position')).toUpperCase()];
    if (!Number.isSafeInteger(id) || id <= 0 || !name || !team || !position) {
      skipped++;
      continue;
    }
    if (ids.has(id)) throw new Error('Il foglio contiene identificativi di calciatori duplicati.');
    ids.add(id);
    const matches = metric(cell('appearances'));
    const appearances = Number.isSafeInteger(matches) ? matches : null;
    const listFlag = text(cell('offList'));
    parsed.push({
      id: String(id), name, team, position,
      mantra: shortText(cell('mantra')) || null,
      offList: Boolean(listFlag && !['no', '0', 'false'].includes(key(listFlag))),
      under: metric(cell('under')),
      appearances,
      averageRating: appearances === 0 ? null : metric(cell('averageRating')),
      fantasyAverage: appearances === 0 ? null : metric(cell('fantasyAverage')),
      fvm: metric(cell('fvm')),
      price: metric(cell('price')),
      fantasyTeam: text(cell('fantasyTeam')).slice(0, 150) || null,
      cost: metric(cell('cost'))
    });
  }
  return { rows: parsed, skipped };
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function archiveDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => view.getUint16(offset, true);
  const u32 = offset => view.getUint32(offset, true);
  let end = bytes.length - 22;
  const floor = Math.max(0, end - 65535);
  while (end >= floor && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length)) end--;
  const invalid = 'Il file non è un archivio XLSX valido.';
  if (end < floor) throw new Error(invalid);
  const total = u16(end + 10);
  const start = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || total !== u16(end + 8) || total > 2048
    || start + u32(end + 12) !== end) throw new Error(invalid);
  const entries = new Map();
  let offset = start;
  for (let index = 0; index < total; index++) {
    if (offset + 46 > end || u32(offset) !== 0x02014b50) throw new Error(invalid);
    const nameSize = u16(offset + 28);
    const next = offset + 46 + nameSize + u16(offset + 30) + u16(offset + 32);
    if (next > end) throw new Error(invalid);
    const name = UTF8.decode(bytes.subarray(offset + 46, offset + 46 + nameSize));
    const method = u16(offset + 10);
    const compressed = u32(offset + 20);
    const size = u32(offset + 24);
    const crc = u32(offset + 16);
    const local = u32(offset + 42);
    if (entries.has(name) || u16(offset + 34) || local + 30 > start || u32(local) !== 0x04034b50) {
      throw new Error(invalid);
    }
    const localNameEnd = local + 30 + u16(local + 26);
    const dataStart = localNameEnd + u16(local + 28);
    if (dataStart + compressed > start || method !== u16(local + 8)
      || UTF8.decode(bytes.subarray(local + 30, localNameEnd)) !== name) throw new Error(invalid);
    entries.set(name, { size, crc, method, flags: u16(offset + 8) | u16(local + 6), start: dataStart, end: dataStart + compressed });
    offset = next;
  }
  if (offset !== end) throw new Error(invalid);
  return entries;
}

async function inflatePart(input, size) {
  let decompressor;
  try {
    decompressor = new DecompressionStream('deflate-raw');
  } catch {
    throw new Error('Per aprire questo Excel compresso, usa una versione recente del browser.');
  }
  const reader = new Blob([input]).stream().pipeThrough(decompressor).getReader();
  const result = new Uint8Array(size);
  let offset = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.length > size) throw new Error('Dimensione del contenuto XLSX non valida.');
      result.set(value, offset);
      offset += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (offset !== size) throw new Error('Dimensione del contenuto XLSX non valida.');
  return result;
}

function xmlPartReader(bytes) {
  const directory = archiveDirectory(bytes);
  let expanded = 0;
  return async (path, element) => {
    const part = directory.get(path);
    if (!part) throw new Error('Manca un componente interno dell’export Excel.');
    if (part.flags & 1 || ![0, 8].includes(part.method)) throw new Error('Il formato di compressione o la protezione di questo Excel non è supportato.');
    expanded += part.size;
    if (part.size > MAX_PART || expanded > MAX_EXPANDED) throw new Error('Il contenuto dell’export Excel è troppo grande.');
    const compressed = bytes.subarray(part.start, part.end);
    const raw = part.method === 0 ? compressed : await inflatePart(compressed, part.size);
    if (raw.length !== part.size || crc32(raw) !== part.crc) throw new Error('Il file Excel risulta danneggiato.');
    const xml = UTF8.decode(raw);
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('Il file Excel contiene definizioni XML non supportate.');
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.documentElement.localName !== element || document.getElementsByTagNameNS('*', 'parsererror').length) {
      throw new Error('Il contenuto interno del file Excel non è valido.');
    }
    return document.documentElement;
  };
}

function relationshipPath(target) {
  if (!target || /[\\:?#\u0000-\u001f]/.test(target)) return null;
  const parts = target.startsWith('/') ? [] : ['xl'];
  for (const name of target.split('/')) {
    if (!name || name === '.') continue;
    if (name === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(name);
    }
  }
  return parts.join('/') || null;
}

function child(element, name) {
  return Array.from(element.children).find(node => node.localName === name);
}

function richText(element) {
  const elements = Array.from(element.children);
  return elements.map(node => {
    if (node.localName === 't') return node.textContent;
    if (node.localName === 'r') return child(node, 't')?.textContent ?? '';
    return '';
  }).join('');
}

function cellValue(cell, shared) {
  if (child(cell, 'f')) return null;
  const type = cell.getAttribute('t');
  const value = child(cell, 'v')?.textContent;
  if (type === 'e') return null;
  if (type === 'inlineStr') {
    const inline = child(cell, 'is');
    return inline ? richText(inline) : '';
  }
  if (type !== 's') return value ?? '';
  if (!/^\d+$/.test(value ?? '') || Number(value) >= shared.length) {
    throw new Error('Il file Excel contiene un riferimento a un testo mancante.');
  }
  return shared[Number(value)];
}

function sheetRows(worksheet, shared) {
  const body = child(worksheet, 'sheetData');
  if (!body) return [];
  if (body.childElementCount > MAX_ROWS) throw new Error('Il foglio contiene troppe righe.');
  return Array.from(body.children).filter(node => node.localName === 'row').map(row => {
    const values = [];
    let previous = -1;
    for (const cell of row.children) {
      if (cell.localName !== 'c') continue;
      const reference = cell.getAttribute('r');
      const letters = /^([A-Z]{1,3})\d+$/.exec(reference ?? '')?.[1];
      const index = letters
        ? Array.from(letters).reduce((column, letter) => column * 26 + letter.charCodeAt(0) - 64, 0) - 1
        : previous + 1;
      previous = index;
      if (index < 64) values[index] = cellValue(cell, shared);
    }
    return values;
  });
}

export const readMarketWorkbook = async (buffer) => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 22) throw new Error('Il file non è un archivio XLSX valido.');
  if (bytes.length > MAX_WORKBOOK) throw new Error('Il file Excel supera i 12 MB.');
  const read = xmlPartReader(bytes);
  const workbook = await read('xl/workbook.xml', 'workbook');
  const rels = await read('xl/_rels/workbook.xml.rels', 'Relationships');
  const relations = Array.from(rels.children).filter(node => node.localName === 'Relationship' && node.getAttribute('TargetMode') !== 'External');
  const stringsTarget = relations.find(node => node.getAttribute('Type')?.endsWith('/sharedStrings'))?.getAttribute('Target');
  const stringsPath = relationshipPath(stringsTarget);
  const shared = stringsPath
    ? Array.from((await read(stringsPath, 'sst')).children).filter(node => node.localName === 'si').map(richText)
    : [];
  const worksheets = child(workbook, 'sheets');
  for (const sheet of Array.from(worksheets?.children ?? []).slice(0, 12)) {
    if (sheet.localName !== 'sheet' || ['hidden', 'veryHidden'].includes(sheet.getAttribute('state'))) continue;
    const id = Array.from(sheet.attributes).find(attribute => attribute.localName === 'id' && attribute.namespaceURI)?.value;
    const relation = relations.find(node => node.getAttribute('Id') === id && node.getAttribute('Type')?.endsWith('/worksheet'));
    const path = relationshipPath(relation?.getAttribute('Target'));
    if (!path) continue;
    const parsed = parseMarketRows(sheetRows(await read(path, 'worksheet'), shared));
    if (parsed) return { ...parsed, sheet: sheet.getAttribute('name') ?? '' };
  }
  throw new Error('Non ho trovato il foglio Classic di Fantacalcio.it. Usa il file XLSX «Lista calciatori» o «Svincolati».');
};
