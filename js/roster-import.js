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

export function readVotesCsv(text, { players, teams }) {
  const rows = parseRows(text);
  const headers = (rows.shift() ?? []).map(normalized);
  const columns = Object.fromEntries(['stagione','giornata','id fantalab','nome','squadra','ruolo','fantavoto','voto']
    .map(key => [key, headers.indexOf(key)]));
  const required = ['stagione','giornata','fantavoto'];
  const byName = ['nome','squadra','ruolo'].every(key => columns[key] >= 0);
  if (required.some(key => columns[key] < 0) || (columns['id fantalab'] < 0 && !byName)) {
    throw new Error('Usa le intestazioni del modello CSV dei fantavoti.');
  }
  if (rows.length > 20_000) throw new Error('Il CSV supera 20.000 righe.');

  const playersById = new Map(players.map(player => [player.id, player]));
  const playersByIdentity = new Map();
  for (const player of playersById.values()) {
    const key = JSON.stringify([normalized(player.name), player.teamId, player.position]);
    const candidates = playersByIdentity.get(key) ?? [];
    candidates.push(player);
    playersByIdentity.set(key, candidates);
  }
  const score = (raw, min, max) => {
    if (!raw || ['sv','s v','senza voto'].includes(normalized(raw))) return null;
    const value = /^-?\d+(?:[.,]\d+)?$/.test(raw) ? Number(raw.replace(',', '.')) : NaN;
    return value >= min && value <= max ? value : NaN;
  };
  const seen = new Map();
  const conflicts = new Set();
  const unresolved = [];
  for (const [index, row] of rows.entries()) {
    const cell = key => row[columns[key]] ?? '';
    const suppliedId = cell('id fantalab');
    const label = (cell('nome') || suppliedId || 'Calciatore').slice(0,120);
    const report = reason => unresolved.push({ line: index + 2, label, reason });
    const season = cell('stagione');
    const day = cell('giornata');
    if (!['2025/26','2026/27'].includes(season) || !/^(?:[1-9]|[12]\d|3[0-8])$/.test(day)) {
      report('Stagione o giornata non valida');
      continue;
    }
    const clubs = cell('squadra') ? teamsForLabel(teams, cell('squadra')) : [];
    const position = CLASSIC_ROLES[cell('ruolo').toUpperCase()];
    const key = JSON.stringify([normalized(cell('nome')), clubs[0]?.id, position]);
    const candidates = suppliedId ? [playersById.get(suppliedId)].filter(Boolean)
      : byName && season === '2026/27' && clubs.length === 1 && position ? playersByIdentity.get(key) ?? [] : [];
    if (candidates.length !== 1 || (cell('squadra') && clubs.length !== 1)) {
      report(season === '2025/26' && !suppliedId ? 'Per il 2025/26 serve un ID FantaLab verificato' : 'Identità mancante o ambigua');
      continue;
    }
    const [player] = candidates;
    if (season === '2026/27' && clubs.length && clubs[0].id !== player.teamId ||
        suppliedId && cell('nome') && normalized(cell('nome')) !== normalized(player.name) ||
        suppliedId && cell('ruolo') && position !== player.position) {
      report('I dati del calciatore discordano dall’ID FantaLab');
      continue;
    }
    const rating = score(cell('voto'), 0, 10);
    const fantasyRating = score(cell('fantavoto'), -20, 50);
    if (row.length !== headers.length || Number.isNaN(rating) || Number.isNaN(fantasyRating) ||
        (fantasyRating === null && rating !== null)) {
      report('Voto o fantavoto non valido');
      continue;
    }
    const entry = { id: player.id, season, round: Number(day),
      teamId: clubs[0]?.id ?? (season === '2026/27' ? player.teamId : null), rating, fantasyRating };
    const identity = JSON.stringify([entry.id, season, entry.round]);
    const previous = seen.get(identity);
    if (conflicts.has(identity) || previous && JSON.stringify(previous) !== JSON.stringify(entry)) {
      seen.delete(identity);
      conflicts.add(identity);
      report('Voti discordanti per lo stesso calciatore e giornata');
    } else seen.set(identity, entry);
  }
  return { entries: [...seen.values()], unresolved };
}
