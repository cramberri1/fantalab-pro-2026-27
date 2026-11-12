const CLASSIC_ROLES = { P: 'GK', D: 'DEF', C: 'MID', A: 'FWD' };
const FANTACALCIO_COLUMNS = [
  'costo d acquisto', 'quotazione attuale', 'fvmp', 'media voto', 'fanta media',
  'partite giocate a voto', 'prestito'
];

function normalized(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{Mark}/gu, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function compact(value) {
  return normalized(value).replace(/ /g, '');
}

export function decodeRosterCsv(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function makeRosterCsvId(name, teamId, position) {
  if (typeof name !== 'string' || name.length > 120) return null;
  const key = compact(name);
  if (!key || typeof teamId !== 'string' || !/^[a-z0-9-]+$/.test(teamId) || !Object.values(CLASSIC_ROLES).includes(position)) return null;
  const id = `csv:${teamId}:${position}:${key}`;
  return id.length <= 120 ? id : null;
}

function headerSeparator(text) {
  let quoted = false;
  let semicolons = 0;
  let commas = 0;
  for (const character of text) {
    if (character === '"') quoted = !quoted;
    if (quoted) continue;
    if (character === '\r' || character === '\n') break;
    if (character === ';') semicolons++;
    if (character === ',') commas++;
  }
  return semicolons > commas ? ';' : ',';
}

function parseRows(input) {
  const text = input.replace(/^\uFEFF/, '').trim();
  if (text.includes('\0')) throw new Error('Salva la rosa come file CSV con codifica UTF-8.');
  const separator = headerSeparator(text);
  const rows = [[]];
  let value = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && character === separator) {
      rows.at(-1).push(value.trim());
      value = '';
    } else if (!quoted && (character === '\r' || character === '\n')) {
      if (character === '\r' && text[index + 1] === '\n') index++;
      rows.at(-1).push(value.trim());
      rows.push([]);
      value = '';
    } else value += character;
  }
  if (quoted) throw new Error('CSV con virgolette non chiuse.');
  rows.at(-1).push(value.trim());
  return rows.filter(row => row.some(Boolean));
}

function teamsForLabel(teams, label) {
  const key = normalized(label);
  if (!key) return [];
  return teams.filter(team => [team.id, team.name, team.shortName, team.code]
    .some(alias => normalized(alias) === key));
}

function abbreviatedNameMatches(playerName, inputName) {
  const words = normalized(playerName).split(' ');
  const inputWords = normalized(inputName).split(' ');
  const input = inputWords.join('');
  const matchingInitial = inputWords.length > 1 && inputWords.at(-1) === words[0][0];
  const inputSurname = inputWords.slice(0, -1).join('');
  if (words.join('') === input) return true;
  for (let index = 1; index < words.length; index++) {
    const suffix = words.slice(index).join('');
    if (suffix === input || (matchingInitial && suffix === inputSurname)) return true;
  }
  return false;
}

export function readRosterCsv(text, { players, teams, mode }) {
  const rows = parseRows(text);
  const headers = (rows.shift() ?? []).map(normalized);
  const idColumn = headers.indexOf('id');
  const nameColumn = headers.findIndex(column => ['nome', 'name', 'calciatore'].includes(column));
  const teamColumn = headers.findIndex(column => ['squadra', 'team', 'club'].includes(column));
  const roleColumn = headers.indexOf('ruolo');
  const fantacalcio = headers.includes('nome') && headers.includes('squadra') && roleColumn >= 0
    && FANTACALCIO_COLUMNS.some(column => headers.includes(column));
  if (idColumn < 0 && nameColumn < 0) throw new Error('Il CSV deve avere un’intestazione con id o nome.');
  if (fantacalcio && mode !== 'real') throw new Error('Seleziona Dati reali per importare una rosa di Fantacalcio.it.');

  const entries = [];
  const unresolved = [];
  for (const [index, row] of rows.entries()) {
    const suppliedId = row[idColumn];
    const name = row[nameColumn] ?? '';
    const label = name || suppliedId || `Riga ${index + 2}`;
    const nameKey = normalized(name);
    const clubs = teamsForLabel(teams, row[teamColumn]);
    const clubIds = new Set(clubs.map(team => team.id));
    const inScope = players.filter(player => !row[teamColumn] || clubIds.has(player.teamId));
    const exact = nameKey ? inScope.filter(player => normalized(player.name) === nameKey) : [];

    if (!fantacalcio) {
      const candidates = suppliedId ? players.filter(player => player.id === suppliedId) : exact;
      if (candidates.length === 1) entries.push({ id: candidates[0].id });
      else unresolved.push({ label, reason: candidates.length ? 'Più corrispondenze nel listone' : 'Calciatore non trovato nel listone' });
      continue;
    }

    const position = CLASSIC_ROLES[row[roleColumn]?.toUpperCase()];
    const teamId = clubs.length === 1 ? clubs[0].id : null;
    const localId = makeRosterCsvId(name, teamId, position);
    if (!localId) {
      unresolved.push({ label, reason: !position ? 'Ruolo Classic non riconosciuto' : !teamId ? 'Squadra non riconosciuta' : 'Nome mancante o troppo lungo' });
      continue;
    }

    const candidates = exact.length
      ? exact.filter(player => player.position === position)
      : inScope.filter(player => player.position === position && abbreviatedNameMatches(player.name, name));
    if (candidates.length === 1) entries.push({ id: candidates[0].id, localId });
    else if (candidates.length > 1) unresolved.push({ label, reason: 'Più corrispondenze con la stessa squadra e lo stesso ruolo' });
    else entries.push({ id: localId, local: { id: localId, name, teamId, position } });
  }
  return { entries, unresolved };
}
