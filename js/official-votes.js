import { readWorkbookSheets } from './market-import.js';
import { matchClassicPlayerName } from './roster-import.js';

export const OFFICIAL_VOTE_EDITIONS = Object.freeze(['Fantacalcio', 'Statistico', 'Italia']);
const ROLE = { P: 'GK', D: 'DEF', C: 'MID', A: 'FWD', ALL: 'ALL' };
const EVENT_COLUMNS = {
  gf: 'goals', rf: 'penaltyScored', rp: 'penaltySaved', rs: 'penaltyMissed', au: 'ownGoal',
  gs: 'goalsConceded', amm: 'yellowCard', esp: 'redCard', ass: 'assist'
};
const HEADERS = ['cod', 'ruolo', 'nome', 'voto', ...Object.keys(EVENT_COLUMNS)];
const SEASON = /^20\d{2}\/\d{2}$/;

function label(value) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function key(value) {
  return label(value).normalize('NFKD').replace(/\p{Mark}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function validSeason(value) {
  return SEASON.test(value ?? '') && (Number(value.slice(0, 4)) + 1) % 100 === Number(value.slice(-2));
}

export function officialVotesSeason(filename) {
  const match = /(?:^|[_\s-])stagione[_\s-]+(20\d{2})[_\s-]+(20\d{2}|\d{2})(?=[_.\s-]|$)/i.exec(filename ?? '');
  if (!match) return null;
  const season = `${match[1]}/${match[2].slice(-2)}`;
  return validSeason(season) && (match[2].length === 2 || Number(match[1]) + 1 === Number(match[2])) ? season : null;
}

function resolveSeason(filename, expected, confirmed) {
  const detected = officialVotesSeason(filename);
  if (validSeason(confirmed) && (confirmed === expected || confirmed === detected)) return confirmed;
  if (detected && detected === expected) return detected;
  const error = new Error(detected
    ? `Il nome del file indica la stagione ${detected}. Conferma la stagione prima di importare.`
    : 'Il nome del file non indica la stagione. Confermala prima di importare.');
  error.code = 'SEASON_CONFIRMATION';
  error.detectedSeason = detected;
  throw error;
}

function teamIndex(teams) {
  const aliases = new Map();
  for (const team of teams) {
    for (const alias of [team.id, team.name, team.shortName, team.code]) {
      const name = key(alias);
      if (!name) continue;
      if (!aliases.has(name)) aliases.set(name, new Set());
      aliases.get(name).add(team.id);
    }
  }
  return aliases;
}

function findTeam(aliases, value) {
  const hits = aliases.get(key(value));
  return hits?.size === 1 ? hits.values().next().value : null;
}

function integer(value) {
  const raw = label(value);
  return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}

function readVote(value) {
  const raw = label(value);
  const match = /^(\d+(?:[.,]\d+)?)\s*(\*)?$/.exec(raw);
  const vote = match ? Number(match[1].replace(',', '.')) : NaN;
  return Number.isFinite(vote) && vote <= 10 ? [vote, Boolean(match[2])] : null;
}

function columnPositions(row) {
  const labels = row.map(key);
  if (labels[0] !== 'cod') return null;
  const columns = Object.fromEntries(HEADERS.map(header => [header, labels.indexOf(header)]));
  if (HEADERS.some(header => columns[header] < 0 || labels.lastIndexOf(header) !== columns[header])) return null;
  if (labels.some(label => label && !HEADERS.includes(label))) return null;
  return columns;
}

function parseSheet(rows, edition, aliases) {
  const title = label(rows[0]?.[0]);
  const day = /\b(\d{1,2})\s*[ªº°]\s+giornata\b/i.exec(title);
  const round = Number(day?.[1]);
  if (!/^voti\b/i.test(title) || !Number.isInteger(round) || round < 1 || round > 38) {
    throw new Error(`Giornata non riconosciuta nel foglio ${edition}.`);
  }

  const blocks = new Map();
  const seenCodes = new Set();
  const players = new Map();
  const firstBlock = rows.findIndex((row, index) => index >= 4 &&
    key(rows[index + 1]?.[0]) === 'cod' &&
    row.every((cell, column) => column === 0 || !label(cell)));
  if (firstBlock < 0) throw new Error(`Intestazioni dei voti non riconosciute nel foglio ${edition}.`);
  let block;
  for (let index = firstBlock; index < rows.length; index++) {
    const row = rows[index];
    if (!row.some(cell => label(cell))) continue;
    const rowType = row.every((cell, column) => column === 0 || !label(cell)) ? 'team' : 'player';
    if (rowType === 'team') {
      if (block && (!block.columns || !block.readRows)) throw new Error(`Blocco squadra vuoto nel foglio ${edition}.`);
      const teamName = label(row[0]);
      const teamId = findTeam(aliases, teamName);
      const blockKey = teamId ?? `?${key(teamName)}`;
      if (!teamName || blocks.has(blockKey)) throw new Error(`Squadra duplicata o non valida nel foglio ${edition}.`);
      block = { teamName, teamId, columns: null, readRows: 0, playerRows: 0 };
      blocks.set(blockKey, block);
      continue;
    }
    if (!block) throw new Error(`Riga fuori da un blocco squadra nel foglio ${edition}.`);
    if (!block.columns) {
      block.columns = columnPositions(row);
      if (!block.columns) throw new Error(`Intestazioni dei voti non riconosciute nel foglio ${edition}, riga ${index + 1}.`);
      continue;
    }

    const cell = field => row[block.columns[field]];
    const code = integer(cell('cod'));
    const position = ROLE[label(cell('ruolo')).toUpperCase()];
    const name = label(cell('nome'));
    const vote = readVote(cell('voto'));
    const events = Object.fromEntries(Object.entries(EVENT_COLUMNS).map(([column, field]) => [field, integer(cell(column))]));
    if (!code || !position || !name || name.length > 150 || !vote || Object.values(events).some(value => value === null)) {
      throw new Error(`Voto o evento non valido nel foglio ${edition}, riga ${index + 1}.`);
    }
    if (seenCodes.has(code)) throw new Error(`Codice calciatore duplicato nel foglio ${edition}, riga ${index + 1}.`);
    seenCodes.add(code);
    block.readRows++;
    if (position === 'ALL') continue;
    block.playerRows++;
    players.set(String(code), { code: String(code), name, position, teamId: block.teamId, teamName: block.teamName, vote, events });
  }
  if (!block?.columns || !block.readRows || !players.size) throw new Error(`Il foglio ${edition} non contiene blocchi voto validi.`);
  return { round, blocks, players };
}

function samePlayer(left, right) {
  return right && key(right.name) === key(left.name) && right.teamId === left.teamId &&
    key(right.teamName) === key(left.teamName) && right.position === left.position &&
    Object.keys(EVENT_COLUMNS).every(column => left.events[EVENT_COLUMNS[column]] === right.events[EVENT_COLUMNS[column]]);
}

export function bindOfficialVoteRows(rows, { teams, players, listone = [], readRows = rows.length }) {
  const known = new Map();
  const workbooks = new Map();
  const aliases = teamIndex(teams);
  const scope = (teamId, position) => `${teamId}/${position}`;
  for (const player of new Map(players.map(player => [String(player.id), player])).values()) {
    const scopeKey = scope(player.teamId, player.position);
    if (!known.has(scopeKey)) known.set(scopeKey, []);
    known.get(scopeKey).push(player);
  }
  for (const row of listone) {
    const code = label(row.id);
    if (!code) continue;
    workbooks.set(code, workbooks.has(code) ? null : row);
  }
  const compatibleWorkbook = row => {
    const candidate = workbooks.get(row.code);
    return candidate && findTeam(aliases, candidate.team ?? candidate.teamId) === row.teamId &&
      candidate.position === row.position && matchClassicPlayerName(row.name, [candidate]).length ? candidate : null;
  };
  const denominator = Math.max(rows.length, Number.isSafeInteger(readRows) ? readRows : 0);
  const codeCoverage = workbooks.size && denominator ? rows.filter(compatibleWorkbook).length / denominator : null;
  const bindings = rows.map(row => {
    const candidates = known.get(scope(row.teamId, row.position)) ?? [];
    const workbook = codeCoverage >= 0.95 ? compatibleWorkbook(row) : null;
    const direct = workbook ? candidates.filter(player => label(player.workbookId) === row.code &&
      matchClassicPlayerName(workbook.name, [player]).length) : [];
    let matches = direct.length ? direct : matchClassicPlayerName(workbook?.name ?? row.name, candidates);
    if (!matches.length && workbook && workbook.name !== row.name) matches = matchClassicPlayerName(row.name, candidates);
    return { ...row, id: matches.length === 1 ? String(matches[0].id) : null, candidateIds: matches.map(player => String(player.id)) };
  });

  const idCounts = new Map();
  for (const row of bindings) if (row.id) idCounts.set(row.id, (idCounts.get(row.id) ?? 0) + 1);
  const unmatched = [];
  const mapped = bindings.map(({ candidateIds, ...row }) => {
    const duplicate = row.id && idCounts.get(row.id) > 1;
    if (row.id && !duplicate) return row;
    const ambiguous = Boolean(duplicate || candidateIds.length > 1);
    unmatched.push({ code: row.code, name: row.name, teamId: row.teamId, position: row.position, ambiguous, candidateIds,
      reason: duplicate ? 'Più codici conducono allo stesso calciatore' : ambiguous
        ? 'Più corrispondenze nella stessa squadra e nello stesso ruolo' : 'Calciatore non trovato' });
    return { ...row, id: null };
  });
  return { rows: mapped, unmatched, codeCoverage };
}

export function parseOfficialVoteSheets(sheets, { season, teams = [], players = [], listone = [] } = {}) {
  if (!validSeason(season)) throw new Error('Stagione dei voti non valida.');
  const aliases = teamIndex(teams);
  const byEdition = new Map();
  for (const sheet of sheets) {
    if (!OFFICIAL_VOTE_EDITIONS.includes(sheet.name)) continue;
    if (byEdition.has(sheet.name)) throw new Error(`Foglio duplicato: ${sheet.name}.`);
    byEdition.set(sheet.name, parseSheet(sheet.rows, sheet.name, aliases));
  }
  const missing = OFFICIAL_VOTE_EDITIONS.filter(edition => !byEdition.has(edition));
  if (missing.length) throw new Error(`Fogli voto mancanti: ${missing.join(', ')}.`);
  const base = byEdition.get('Fantacalcio');
  for (const edition of byEdition.values()) {
    if (edition.round !== base.round || edition.players.size !== base.players.size ||
      edition.blocks.size !== base.blocks.size || [...base.blocks.keys()].some(team => !edition.blocks.has(team))) {
      throw new Error('I fogli del file non corrispondono alla stessa giornata o alle stesse squadre.');
    }
  }
  const warnings = [];
  const teamIds = [...base.blocks.values()].filter(block => block.teamId && block.playerRows > 0).map(block => block.teamId);
  for (const block of base.blocks.values()) {
    if (!block.teamId) warnings.push(`Blocco ignorato: squadra non riconosciuta «${block.teamName}».`);
    else if (!block.playerRows) warnings.push(`Nessun calciatore a voto per ${block.teamName}.`);
  }
  if (!teamIds.length) throw new Error('Nessun blocco squadra è stato riconosciuto nel file voti.');
  const rows = [];
  for (const [code, row] of base.players) {
    const votes = {};
    for (const edition of OFFICIAL_VOTE_EDITIONS) {
      const other = byEdition.get(edition).players.get(code);
      if (!samePlayer(row, other)) throw new Error('I codici, le identità o gli eventi differiscono fra i fogli del file.');
      votes[edition] = other.vote;
    }
    if (row.teamId) rows.push({ code, name: row.name, teamId: row.teamId, position: row.position, votes, events: row.events });
  }
  const complete = teamIds.length === 20 && base.blocks.size === teamIds.length;
  const goals = rows.reduce((total, row) => total + row.events.goals + row.events.penaltyScored + row.events.ownGoal, 0);
  const conceded = rows.filter(row => row.position === 'GK').reduce((total, row) => total + row.events.goalsConceded, 0);
  if (complete && goals !== conceded) warnings.push(`Controllo gol da verificare: Gf + Rf + Au = ${goals}, Gs dei portieri = ${conceded}.`);
  const counts = [...base.blocks.values()].reduce((total, block) => total + block.readRows, 0);
  return { season, round: base.round, teamIds, complete, warnings, readRows: base.players.size,
    ignoredCoaches: counts - base.players.size, ...bindOfficialVoteRows(rows, { teams, players, listone, readRows: base.players.size }) };
}

export const readOfficialVotesWorkbook = async (buffer, { filename, season, confirmedSeason, ...context } = {}) => {
  const selectedSeason = resolveSeason(filename, season, confirmedSeason);
  const sheets = await readWorkbookSheets(buffer, name => OFFICIAL_VOTE_EDITIONS.includes(name));
  return parseOfficialVoteSheets(sheets, { ...context, season: selectedSeason });
};
