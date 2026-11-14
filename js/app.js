import { analyzePlayer, simulateLineup, FORMATION_OPTIONS, validateLineup, getPlayerFixture, getAvailability, placeLineupPlayer, sanitizeScoring } from './model.js';
import { decodeRosterCsv, makeRosterCsvId, readRosterCsv, readVotesCsv } from './roster-import.js';
import { readMarketWorkbook } from './market-import.js';
import { buildMarket, rankMarketReplacements, compareMarketTrade, indexLeagueStatistics } from './market.js';
import { fixtureCalendarDay, getRoundWindow, isPendingFixture } from './calendar.js';
import { predictMatch, backtestMatches, matchScoreSampler, predictMatchRates } from './match-model.js';
import { wireLineupDrag } from './lineup-drag.js';
import { buildLineupContext } from './lineup-context.js';
import { compareLineups, renderLineupComparison } from './lineup-comparison.js';
import { manualAvailabilityRecord, sanitizeManualAvailability, renderManualAvailability, lineupManualLabel } from './manual-availability.js';
import { buildFixtureDifficulty, renderFixtureDifficulty } from './fixture-difficulty.js';
import { suggestLineup } from './lineup-suggestion.js';
import { evaluateLineupPerformance } from './lineup-performance.js';
import { OFFICIAL_VOTE_EDITIONS, officialVotesSeason, readOfficialVotesWorkbook, bindOfficialVoteRows } from './official-votes.js';
import { buildOfficialVoteIndex } from './official-vote-model.js';
import { cleanOfficialArchive, readOfficialArchive, writeOfficialArchive } from './official-vote-storage.js';
import { renderPanoramica } from './view-panoramica.js';
import { renderMatch } from './view-match.js';
import { renderGiocatori } from './view-giocatori.js';
import { renderAnalisi } from './view-analisi.js';
import { renderRosa } from './view-rosa.js';
import { renderMercato } from './view-mercato.js';
import { renderSimulazione } from './view-simulazione.js';
import { renderRendimento } from './view-rendimento.js';
import { renderFonti } from './view-fonti.js';

const PAGES = {
  panoramica: 'Panoramica', match: 'Match Center', giocatori: 'Calciatori', analisi: 'Analisi',
  rosa: 'La mia rosa', mercato: 'Mercato', simulazione: 'Simulazione', rendimento: 'Rendimento', fonti: 'Fonti e metodo'
};
const ROLES = { GK: 'Portiere', DEF: 'Difensore', MID: 'Centrocampista', FWD: 'Attaccante' };
const SHORT = { GK: 'P', DEF: 'D', MID: 'C', FWD: 'A' };
const COVERAGE = {
  fixtures: 'Calendario', results: 'Risultati', players: 'Listone calciatori',
  playerStats: 'Statistiche individuali', ratings: 'Voti storici FantaTB', expectedGoals: 'xG individuali',
  expectedAssists: 'xA individuali', teamExpectedGoals: 'xG stagionali di squadra', fixtureExpectedGoals: 'xG delle singole partite',
  absences: 'Indisponibilità'
};
const STATUS = { available: 'Disponibile', partial: 'Parziale', missing: 'Mancante', demo: 'Demo' };
const ICONS = {
  brand: '<path d="M2 13h5l3-7 4 12 3-5h5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  pitch: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14M3 9h4v6H3m18-6h-4v6h4"/><circle cx="12" cy="12" r="2.5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4m-3-12a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/>',
  shirt: '<path d="m8 3-5 3-2 5 4 2 2-3v11h10V10l2 3 4-2-2-5-5-3a4 4 0 0 1-8 0z"/>',
  market: '<path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4 4-4-4 4-4"/>',
  chart: '<path d="M3 3v18h18M7 15l4-4 3 3 6-7"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14a8 3 0 0 0 16 0V5M4 12a8 3 0 0 0 16 0"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  shield: '<path d="M12 22s7-4 7-11V5l-7-3-7 3v6c0 7 7 11 7 11Z"/><path d="m9 12 2 2 4-4"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>'
};
const dateFormatter = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short' });
const timeFormatter = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
const KEY = 'fantalab-pro/2026-27/v1';
const MARKET_KEY = 'fantalab-pro/2026-27/mercato/v1/';
const VOTES_KEY = 'fantalab-pro/2026-27/fantavoti/v1';
const MARKET_UPLOADS = { listone: 'Listone completo', svincolati: 'Svincolati della lega' };
const PER_PAGE = 24;
const $ = (selector) => document.querySelector(selector);
const pageView = $('#view');
const dialog = $('#player-dialog');
const cache = new Map();
const filters = { search: '', position: '', team: '', sort: 'name', page: 1 };
const marketFilters = { tab: 'riparazione', search: '', role: '', outgoing: '', incoming: '', budget: '', credits: '', page: 1 };
const selectedComparison = { real: [], demo: [] };
const selectedRounds = { real: null, demo: null };
const views = { panoramica, match, giocatori, analisi, rosa, mercato, simulazione, rendimento, fonti };
let dataset;
let mode = 'real';
let round = 1;
let page = currentPage();
let selectedFixtureId;
let simulationResult;
let loadVersion = 0;
let toastTimer;
let persistenceWarned = false;
let lastFocus;
let storage = readStorage();
let marketImports = Object.fromEntries(Object.keys(MARKET_UPLOADS).map(kind => [kind, readMarketSource(kind)]));
let marketCache;
let leagueStatsCache;
let leagueSamplesCache;
let marketNotice = '';
let votesReport;
let votesImport = readVotesImport();
let votesByPlayer = indexVotes(votesImport);
let votesImportVersion = 0;
let officialArchive = { edition:'Fantacalcio', days:[], revision:0 };
let officialCache;
let officialLoaded = false;
let officialBusy = false;
let officialMessage = '';
let officialPending;
let historicalArchive;
let historicalError = false;
let historicalRequest;
let matchBacktest;
let lineupSelection;
const lineupUndo = { real: new Map(), demo: new Map() };
let lineupCopyPreview = false;
let lineupComparisonResult;
let lineupSuggestion;
let difficultyCache;
let showDifficulty = false;
let analysisTeamId;
const marketReadVersion = { listone: 0, svincolati: 0 };

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]
  ));
}
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}
function iconSpan(name) {
  return `<span data-icon="${name}">${icon(name)}</span>`;
}
function number(value, digits = 0) {
  return Number.isFinite(value) ? value.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
}
function date(value) {
  if (!value) return 'Data da definire';
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00+01:00` : value);
  return Number.isNaN(parsed.valueOf()) ? 'Data da definire' : dateFormatter.format(parsed);
}
function percent(value) { return Number.isFinite(value) ? `${number(value * 100)}%` : '—'; }
function per90(value, minutes) { return Number.isFinite(value) && minutes > 0 ? value * 90 / minutes : null; }
function normalized(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function safeUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; }
  catch { return ''; }
}
function readStorage() {
  try { return sanitizeBackup(JSON.parse(localStorage.getItem(KEY) ?? '{}')); }
  catch { return { real: {}, demo: {} }; }
}
function sanitizeBackup(raw) {
  const clean = { real: {}, demo: {} };
  const ids = values => Array.isArray(values)
    ? [...new Set(values.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 120))].slice(0, 1000)
    : [];
  for (const m of ['real', 'demo']) {
    const saved = raw?.[m];
    if (!saved || typeof saved !== 'object') continue;
    clean[m].roster = ids(saved.roster);
    clean[m].availability = sanitizeManualAvailability(saved.availability);
    if (saved.scoring && typeof saved.scoring === 'object') clean[m].scoring = sanitizeScoring(saved.scoring);
    clean[m].penaltyTakers = ids(saved.penaltyTakers);
    clean[m].forecasts = sanitizeForecasts(saved.forecasts);
    if (m === 'real') {
      clean[m].rosterLocals = {};
      for (const id of clean[m].roster) {
        const player = saved.rosterLocals?.[id];
        if (!player || makeRosterCsvId(player.name, player.teamId, player.position) !== id) continue;
        const { name, teamId, position } = player;
        clean[m].rosterLocals[id] = { id, name, teamId, position };
      }
    }
    for (const key of ['lineups','references']) {
      clean[m][key] = {};
      for (const [day, value] of Object.entries(saved[key] ?? {})) {
        if (!/^(?:[1-9]|[12]\d|3[0-8])$/.test(day) || !value || typeof value !== 'object') continue;
        const starters = ids(value.starters).slice(0, 11);
        clean[m][key][day] = {
          formation: FORMATION_OPTIONS.includes(value.formation) ? value.formation : '3-4-3',
          starters,
          reserves: ids(value.reserves).filter(id => !starters.includes(id)),
          maxSubstitutions: Number.isInteger(value.maxSubstitutions) ? Math.max(0, Math.min(5, value.maxSubstitutions)) : 3
        };
      }
    }
  }
  return clean;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(storage)); }
  catch {
    if (!persistenceWarned) {
      notify('Il browser non consente il salvataggio. Esporta un backup prima di chiudere.');
      persistenceWarned = true;
    }
  }
}
function modeState() {
  const saved = storage[mode];
  saved.roster ??= [];
  saved.rosterLocals ??= {};
  saved.lineups ??= {};
  saved.references ??= {};
  saved.availability ??= {};
  saved.penaltyTakers ??= [];
  saved.forecasts ??= {};
  return saved;
}
function lineup() {
  const state = modeState();
  state.lineups[round] ??= { formation: '3-4-3', starters: [], reserves: [], maxSubstitutions: 3 };
  return state.lineups[round];
}
function lineupSnapshot(record) {
  return { ...record, starters: [...record.starters], reserves: [...record.reserves] };
}
function invalidateLineupResults() {
  simulationResult = undefined;
  lineupComparisonResult = undefined;
  lineupSuggestion = undefined;
}
function sanitizeForecasts(value) {
  const forecasts = {};
  for (const [day, raw] of Object.entries(value && typeof value === 'object' ? value : {})) {
    if (!/^(?:[1-9]|[12]\d|3[0-8])$/.test(day) || raw?.round !== Number(day) || raw.season !== '2026/27' ||
        !Number.isFinite(Date.parse(raw.asOf)) || !Number.isFinite(raw.expectedPoints) || !Array.isArray(raw.starters) ||
        !Array.isArray(raw.reserves)) continue;
    const players = rows => rows.filter(p => p && typeof p.id === 'string' && p.id.length <= 120 &&
      typeof p.name === 'string' && Object.hasOwn(ROLES,p.position)).map(p => ({
      id:p.id, name:p.name.slice(0,120), position:p.position, teamId:typeof p.teamId === 'string' ? p.teamId.slice(0,50) : undefined,
      expectedPoints:Number.isFinite(p.expectedPoints) ? p.expectedPoints : null
    }));
    const starters = players(raw.starters);
    if (starters.length !== 11 || new Set(starters.map(p => p.id)).size !== 11) continue;
    const ids = new Set(starters.map(p => p.id));
    const reserves = players(raw.reserves.slice(0,1000)).filter(p => !ids.has(p.id) && ids.add(p.id));
    forecasts[day] = { round:raw.round, season:raw.season, asOf:raw.asOf, expectedPoints:raw.expectedPoints,
      starters, reserves, coverage:Number.isFinite(raw.coverage) ? Math.max(0,Math.min(1,raw.coverage)) : null,
      complete:raw.complete === true, method:typeof raw.method === 'string' ? raw.method.slice(0,50) : null,
      source:typeof raw.source === 'string' ? raw.source.slice(0,120) : null,
      sourceId:typeof raw.sourceId === 'string' ? raw.sourceId.slice(0,250) : null,
      maxSubstitutions:Number.isInteger(raw.maxSubstitutions) ? Math.max(0,Math.min(5,raw.maxSubstitutions)) : 3 };
  }
  return forecasts;
}
function manualAvailabilityFor(id) {
  const reports = modeState().availability[round];
  return reports && Object.hasOwn(reports, id) ? reports[id] : undefined;
}
function roundAvailability() {
  return new Map(Object.entries(modeState().availability[round] ?? {}));
}
function currentPage() {
  const name = location.hash.slice(1);
  return Object.hasOwn(PAGES, name) ? name : 'panoramica';
}
function rounds() {
  return [...new Set(dataset.fixtures.map(fixture => fixture.round))].sort((a, b) => a - b);
}
function byRound(day = round) {
  return dataset.fixtures.filter(f => f.round === day).sort((a, b) =>
    (fixtureCalendarDay(a) ?? '9999').localeCompare(fixtureCalendarDay(b) ?? '9999') ||
    (Date.parse(a.kickoff) || Infinity) - (Date.parse(b.kickoff) || Infinity)
  );
}
function getTeam(id) { return dataset.teamMap.get(id); }
function getPlayer(id) {
  return dataset.playerMap.get(id) ?? (typeof id === 'string' && id.startsWith('csv:') ? modeState().rosterLocals[id] : undefined);
}
function groupPlayers(ids) { return ids.map(getPlayer).filter(Boolean); }
function status(label, state) { return `<span class="status ${html(state)}">${html(label)}</span>`; }
function coverageRows(keys = Object.keys(COVERAGE)) {
  return `<ul class="source-list">${keys.map(key => {
    const value = dataset.coverage[key] ?? 'missing';
    const shown = mode === 'demo' && value !== 'missing' ? 'demo' : value;
    const label = shown === 'demo' && value === 'partial' ? 'Demo · Parziale' : STATUS[shown] ?? 'Mancante';
    return `<li><span>${html(COVERAGE[key])}</span>${status(label, shown)}</li>`;
  }).join('')}</ul>`;
}
function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4800);
}
function setModeNotice() {
  $('#mode-notice').innerHTML = (mode === 'demo'
    ? '<div class="notice"><strong>Modalità demo</strong> Squadre, calciatori, risultati e statistiche sono inventati. Le tue formazioni demo sono salvate a parte.</div>'
    : '') + (dataset.offline ? `<div class="notice"><strong>Archivio offline</strong> Dati salvati ${dataset.updatedAt ? `del ${html(date(dataset.updatedAt))}` : 'nel browser'}.</div>` : '');
}
async function loadDataset(nextMode) {
  if (cache.has(nextMode)) return cache.get(nextMode);
  const embedded = document.getElementById(`data-${nextMode}`);
  const path = nextMode === 'real' ? './data/serie-a-2026-27.json' : './data/demo.json';
  let raw;
  let offline = false;
  if (embedded) raw = JSON.parse(embedded.textContent);
  else {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) throw new Error('Dati non raggiungibili.');
    offline = response.headers.get('X-Fantalab-Offline') === '1';
    raw = await response.json();
  }
  if (raw.mode !== nextMode || raw.season !== '2026/27' || raw.schemaVersion !== 1) throw new Error('Formato dati incompatibile.');
  for (const key of ['teams', 'fixtures', 'players', 'sources', 'absences']) {
    if (!Array.isArray(raw[key])) throw new Error('Dataset incompleto.');
  }
  if (!raw.coverage || typeof raw.coverage !== 'object') throw new Error('Copertura sconosciuta.');
  const loaded = {
    ...raw, offline,
    playerMap: new Map(raw.players.map(player => [player.id, player])),
    teamMap: new Map(raw.teams.map(team => [team.id, team]))
  };
  cache.set(nextMode, loaded);
  return loaded;
}
async function switchMode(nextMode) {
  const request = ++loadVersion;
  pageView.setAttribute('aria-busy', 'true');
  try {
    const loaded = await loadDataset(nextMode);
    if (request !== loadVersion) return;
    if (dialog.open) dialog.close();
    mode = nextMode;
    dataset = loaded;
    round = rounds().includes(selectedRounds[mode]) ? selectedRounds[mode] : getRoundWindow(dataset).defaultRound;
    selectedFixtureId = undefined;
    invalidateLineupResults();
    lineupCopyPreview = false;
    Object.assign(filters, { search: '', position: '', team: '', sort: 'name', page: 1 });
    setModeNotice();
    render();
    if (['analisi','match','simulazione'].includes(page) && mode === 'real') void loadHistoricalArchive();
  } catch (error) {
    if (request !== loadVersion) return;
    const message = 'Impossibile caricare questo insieme di dati. Riprova o apri la copia HTML autonoma.';
    if (dataset) notify(message);
    else pageView.innerHTML = `<p class="notice">${message}</p>`;
  } finally {
    if (request === loadVersion) pageView.setAttribute('aria-busy', 'false');
  }
}
function render() {
  if (!dataset) return;
  lineupSelection = undefined;
  $('#page-label').textContent = PAGES[page];
  const select = $('#round');
  select.innerHTML = (rounds().length ? rounds() : [round]).map(r => `<option value="${r}">Giornata ${r}</option>`).join('');
  select.value = String(round);
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  }
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  pageView.innerHTML = views[page]();
  if (page === 'match' && showDifficulty) {
    showDifficulty = false;
    requestAnimationFrame(() => $('#fixture-difficulty')?.scrollIntoView({ block:'start' }));
  }
}
function goRound(next) {
  if (!rounds().includes(next) || next === round) return;
  round = next;
  selectedRounds[mode] = round;
  selectedFixtureId = undefined;
  invalidateLineupResults();
  lineupCopyPreview = false;
  render();
}
function heading(title, description, actions = '') {
  return `<div class="page-heading"><div><div class="eyebrow">Serie A · Giornata ${round}</div><h1>${title}</h1><p>${description}</p></div>${actions}</div>`;
}
function empty(message) { return `<p class="empty">${message}</p>`; }
function metric(name, value, caption, image) {
  return `<article class="metric"><div class="metric-head">${iconSpan(image)} ${name}</div><strong class="metric-value">${value}</strong><small>${caption}</small></article>`;
}
function matchTime(fixture) {
  const day = fixtureCalendarDay(fixture);
  if (fixture.status === 'played') return `Finale · ${date(day)}`;
  if (fixture.status === 'postponed') return 'Rinviata';
  if (fixture.status === 'cancelled') return 'Annullata';
  if (fixture.status === 'live') return 'In corso';
  if (fixture.status === 'unknown' || mode !== 'demo' && !isPendingFixture(fixture)) return 'Risultato mancante';
  return fixture.kickoff ? `${date(day)} · ${timeFormatter.format(new Date(fixture.kickoff))}` : `${date(day)} · Ora da definire`;
}
function teamPill(id, away = false) {
  const team = getTeam(id);
  const code = team?.code ?? team?.shortName?.slice(0, 3).toUpperCase() ?? '—';
  const mark = `<span class="team-code${away ? ' alt' : ''}" aria-hidden="true">${html(code)}</span>`;
  const name = `<span class="team-name">${html(team?.shortName ?? team?.name ?? 'Squadra mancante')}</span>`;
  return `<span class="team${away ? ' away' : ''}">${away ? name + mark : mark + name}</span>`;
}
function score(fixture) {
  return Number.isFinite(fixture.homeGoals) && Number.isFinite(fixture.awayGoals)
    ? `${fixture.homeGoals}–${fixture.awayGoals}` : '–';
}
function fixtureList(fixtures, current) {
  if (!fixtures.length) return empty('Nessuna partita acquisita per questa giornata.');
  return `<ul class="fixture-list">${fixtures.map(f => `<li><button class="fixture-row" type="button" data-fixture="${html(f.id)}" data-fixture-round="${f.round}"${f.id === current ? ' aria-current="true"' : ''}>
    <span class="fixture-main">${teamPill(f.homeId)}<span class="score">${score(f)}</span>${teamPill(f.awayId, true)}</span>
    <span class="fixture-detail">${html(matchTime(f))}</span>
  </button></li>`).join('')}</ul>`;
}
function roundPreview(day, title, note = '') {
  const fixtures = byRound(day);
  return `<section class="panel"><div class="panel-head"><div><h2>${title}</h2>
    <p>Giornata ${day} · ${fixtures.length} incontri${note}</p></div>
    <button type="button" data-open-match-round="${day}" aria-label="Vedi giornata ${day} nel Match Center">Vedi giornata</button>
  </div>${fixtureList(fixtures)}</section>`;
}
function panoramica() {
  return renderPanoramica({
    dataset, round, getRoundWindow, groupPlayers, modeState, iconSpan, metric, number, roundPreview,
    coverageRows
  });
}
function previousForm(teamId, fixture) {
  const cutoff = fixtureCalendarDay(fixture);
  if (!cutoff) return null;
  const games = dataset.fixtures.filter(f => f.status === 'played' && fixtureCalendarDay(f) && fixtureCalendarDay(f) < cutoff &&
    (f.homeId === teamId || f.awayId === teamId) && Number.isFinite(f.homeGoals) && Number.isFinite(f.awayGoals))
    .sort((a, b) => fixtureCalendarDay(b).localeCompare(fixtureCalendarDay(a))).slice(0, 5);
  if (games.length < 3) return null;
  const mean = (homeKey, awayKey) => {
    const values = games.map(f => f.homeId === teamId ? f[homeKey] : f[awayKey]);
    return values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  return {
    n: games.length,
    newestRound: games[0].round,
    oldestRound: games.at(-1).round,
    gf: mean('homeGoals', 'awayGoals'),
    ga: mean('awayGoals', 'homeGoals'),
    xg: mean('homeXg', 'awayXg'),
    xga: mean('awayXg', 'homeXg')
  };
}
function opponentLevel(side, role) {
  if (!side) return 'Mancante';
  const attack = side.xg ?? side.gf;
  const defense = side.xga ?? side.ga;
  const difficulty = role === 'defense' ? attack : role === 'attack' ? 2.8 - defense : (attack + 2.8 - defense) / 2;
  return difficulty >= 1.68 ? 'Alta' : difficulty >= 1.12 ? 'Media' : 'Bassa';
}
function formSummary(form) {
  return form ? `${form.n} partite acquisite · G${form.oldestRound}–G${form.newestRound} · ${number(form.gf, 2)} gol fatti / ${number(form.ga, 2)} subiti a partita` : 'Meno di tre risultati precedenti acquisiti';
}
function sourceLink(id) {
  const source = dataset.sources.find(item => item.id === id);
  const href = safeUrl(source?.url);
  return href ? `<a class="text-link" href="${html(href)}" target="_blank" rel="noopener noreferrer">${html(source.name)}</a>` : '';
}
function teamSeasonXg(fixture) {
  const teams = [getTeam(fixture.homeId),getTeam(fixture.awayId)].filter(team => Number.isFinite(team?.stats?.xg));
  if (mode !== 'real' || !teams.length) return '';
  return `<div class="duel"><h3>xG stagionali di squadra</h3>${teams.map(team => {
    const stats = team.stats;
    return `<p>${html(team.shortName)} · ${number(stats.xg,2)} xG${Number.isFinite(stats.xga) ? ` · ${number(stats.xga,2)} xGA` : ''}${Number.isFinite(stats.xgMatches) ? ` · ${number(stats.xgMatches)} partite misurate` : ''}</p>`;
  }).join('')}<p>Totali dello snapshot stagionale. ${sourceLink(teams[0].stats.xgSource)}</p></div>`;
}
function matchCard(fixture) {
  if (!fixture) return empty('Seleziona un incontro.');
  const home = previousForm(fixture.homeId, fixture);
  const away = previousForm(fixture.awayId, fixture);
  const scheduled = fixture.status === 'scheduled' && (mode === 'demo' || isPendingFixture(fixture));
  const prediction = scheduled ? predictMatch(fixture, dataset.fixtures, mode === 'real' ? historicalArchive?.fixtures : []) : null;
  const odds = prediction?.probabilities;
  const rows = [['Difesa e portiere','defense','Produzione offensiva avversaria'],['Centrocampo','midfield','Equilibrio tra gol fatti e concessi dall’avversario'],['Attacco','attack','Gol concessi dall’avversario']];
  const absences = dataset.absences.filter(a => a.fixtureId === fixture.id);
  const statusLabels = { out: 'Indisponibile', doubtful: 'In dubbio', available: 'Disponibile', reported: 'Segnalata', unknown: 'Stato mancante' };
  return `<div class="detail-header"><h2>${html(getTeam(fixture.homeId)?.shortName)} – ${html(getTeam(fixture.awayId)?.shortName)}</h2>${status(score(fixture), fixture.status === 'played' ? 'available' : 'missing')}</div>
    <p>${html(matchTime(fixture))}${fixture.resultSourceId ? ` · ${sourceLink(fixture.resultSourceId)}` : ''}</p>
    <div class="duel"><h3>Andamento prima della partita</h3><p>Casa · ${formSummary(home)}</p><p>Trasferta · ${formSummary(away)}</p>
      <p>xG / xGA a partita · casa ${number(home?.xg, 2)} / ${number(home?.xga, 2)} · trasferta ${number(away?.xg, 2)} / ${number(away?.xga, 2)}</p></div>
    ${teamSeasonXg(fixture)}
    <div class="duel"><h3>Difficoltà per reparto</h3><p>Stima dai risultati precedenti acquisiti, fino a cinque partite per squadra. Il centrocampo usa una media dei due indicatori di squadra.</p></div>
    ${rows.map(([label, role, hint]) => `<div class="duel"><div class="duel-row"><span>${status(opponentLevel(away, role), away ? 'partial' : 'missing')}</span><strong>${label}</strong><span>${status(opponentLevel(home, role), home ? 'partial' : 'missing')}</span></div><p>${hint}</p></div>`).join('')}
    ${odds ? `<div class="duel"><h3>Stima 1X2</h3><div class="probability" aria-hidden="true">${odds.map(value => `<span style="width:${value * 100}%"></span>`).join('')}</div>
      <div class="legend"><span>Casa ${percent(odds[0])}</span><span>Pareggio ${percent(odds[1])}</span><span>Trasferta ${percent(odds[2])}</span></div>
      <p>Gol attesi dal modello · casa ${number(prediction.homeRate,2)} · trasferta ${number(prediction.awayRate,2)}.</p>
      <p>${prediction.model === 'dixon-coles' ? 'Poisson con correzione Dixon–Coles' : 'Poisson per squadra'} · fattore campo ${number(prediction.homeAdvantage, 2)}.
      Campione · ${number(prediction.currentMatches)} risultati della stagione${prediction.priorMatches ? ` · ${number(prediction.priorMatches)} risultati 2025/26` : ''}.</p>
      ${mode === 'real' ? '<a class="text-link" href="#analisi">Verifica retrospettiva del modello</a>' : ''}</div>`
      : scheduled ? empty('Risultati precedenti insufficienti per stimare le probabilità 1X2.') : ''}
    <div class="duel"><h3>Indisponibilità segnalate</h3>${absences.length ? `<ul>${absences.map(a => `<li>${html(getPlayer(a.playerId)?.name ?? a.playerId)} · ${html(statusLabels[a.status] ?? 'Stato mancante')}${a.reason ? ` · ${html(a.reason)}` : ''}</li>`).join('')}</ul>`
      : '<p>Nessuna segnalazione acquisita per questo incontro. La disponibilità dei singoli resta sconosciuta.</p>'}</div>
    <div class="duel"><h3>Analisi individuale</h3><p>Apri il listone di una squadra per vedere statistiche, disponibilità e indice per questa giornata.</p>
      <div class="actions"><button data-club="${html(fixture.homeId)}">${html(getTeam(fixture.homeId)?.shortName ?? 'Casa')}</button><button data-club="${html(fixture.awayId)}">${html(getTeam(fixture.awayId)?.shortName ?? 'Trasferta')}</button></div></div>`;
}
function match() {
  return renderMatch({
    dataset, round, selectedFixtureId, byRound, rounds, getRoundWindow, heading, fixtureList, matchCard,
    renderFixtureDifficulty, difficultyGrid, html, number
  });
}
function difficultyGrid() {
  const asOf = Date.now();
  const day = fixtureCalendarDay({ kickoff: new Date(asOf).toISOString() });
  if (difficultyCache?.dataset === dataset && difficultyCache.day === day && difficultyCache.archive === historicalArchive) return difficultyCache.grid;
  const next = getRoundWindow(dataset).next;
  const grid = buildFixtureDifficulty({ teams:dataset.teams, fixtures:dataset.fixtures,
    priorFixtures:mode === 'real' ? historicalArchive?.fixtures : [],
    rounds:next == null ? [] : rounds().filter(item => item >= next), asOf,
    predict:predictMatchRates, calendarDay:fixtureCalendarDay });
  difficultyCache = { dataset, day, archive:historicalArchive, grid };
  return grid;
}
function teamDifficulty(teamId) {
  const grid = difficultyGrid();
  return { ...grid, rows:grid.rows.filter(row => row.team.id === teamId) };
}
function playerAnalysis(player, method) {
  return analyzePlayer(player, {
    dataset, fixture: getPlayerFixture(player, dataset.fixtures, round), round, mode,
    fantasySample: leagueFantasySamples().get(player.id),
    leagueVotes: mode === 'real' ? votesByPlayer.get(player.id) : undefined,
    manualAvailability: manualAvailabilityFor(player.id), method, scoring: modeState().scoring,
    penaltyTaker: modeState().penaltyTakers.includes(player.id),
    officialVotes: mode === 'real' ? officialVoteIndex() : undefined
  });
}
function playerList() {
  const query = normalized(filters.search);
  const candidates = dataset.players.filter(p => (!filters.position || p.position === filters.position)
    && (!filters.team || p.teamId === filters.team)
    && (!query || normalized(`${p.name} ${getTeam(p.teamId)?.shortName ?? ''}`).includes(query)));
  const scoreFor = filters.sort === 'index' ? new Map(candidates.map(p => [p.id, playerAnalysis(p).index])) : null;
  const sortValue = p => filters.sort === 'index' ? scoreFor.get(p.id) : p[filters.sort];
  candidates.sort((a, b) => (filters.sort === 'name' ? 0 : (sortValue(b) ?? -Infinity) - (sortValue(a) ?? -Infinity)) || a.name.localeCompare(b.name, 'it'));
  const maxPage = Math.max(1, Math.ceil(candidates.length / PER_PAGE));
  filters.page = Math.min(maxPage, filters.page);
  const visible = candidates.slice((filters.page - 1) * PER_PAGE, filters.page * PER_PAGE);
  if (!visible.length) return empty('Nessun calciatore corrisponde ai filtri.');
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Listone calciatori, scorrimento orizzontale">
    <table><thead><tr><th>Calciatore</th><th>Club</th><th>Ruolo</th><th class="numeric">Min</th><th class="numeric">Gol</th><th class="numeric">Assist</th><th class="numeric">xG</th><th class="numeric">xA</th><th class="numeric">Indice</th><th>Confronto</th><th>Rosa</th></tr></thead>
    <tbody>${visible.map(p => {
      const picked = modeState().roster.includes(p.id);
      return `<tr><td><button class="player-name" data-player="${html(p.id)}">${html(p.name)}</button></td>
        <td>${html(getTeam(p.teamId)?.shortName ?? '—')}</td><td>${SHORT[p.position] ?? '—'}</td>
        <td class="numeric">${number(p.minutes)}</td><td class="numeric">${number(p.goals)}</td><td class="numeric">${number(p.assists)}</td><td class="numeric">${number(p.xg, 2)}</td><td class="numeric">${number(p.xa, 2)}</td>
        <td class="numeric">${number(scoreFor ? scoreFor.get(p.id) : playerAnalysis(p).index)}</td>
        <td><label><input type="checkbox" data-compare="${html(p.id)}" ${selectedComparison[mode].includes(p.id) ? 'checked' : ''} aria-label="Confronta ${html(p.name)}"></label></td>
        <td><button class="icon-button" data-add="${html(p.id)}" aria-label="Aggiungi ${html(p.name)} alla rosa" ${picked ? 'disabled' : ''}>${picked ? '✓' : '+'}</button></td></tr>`;
    }).join('')}</tbody></table></div>
    <div class="paging"><button data-page-change="-1" ${filters.page === 1 ? 'disabled' : ''}>← Precedente</button><span aria-live="polite">Pagina ${filters.page} / ${maxPage} · ${number(candidates.length)} calciatori</span><button data-page-change="1" ${filters.page === maxPage ? 'disabled' : ''}>Successiva →</button></div>`;
}
function comparison() {
  const candidates = groupPlayers(selectedComparison[mode]);
  if (!candidates.length) return '';
  if (candidates.length === 1) return `<section class="panel stacked"><h2>Confronto</h2><p>Hai selezionato ${html(candidates[0].name)}. Puoi confrontare fino a tre calciatori.</p></section>`;
  const estimates = new Map(candidates.map(player => [player.id, playerAnalysis(player)]));
  const context = playerContexts(candidates);
  const metrics = {
    'Presenze': p => number(p.appearances), 'Minuti': p => number(p.minutes), 'Gol': p => number(p.goals),
    'Assist': p => number(p.assists), 'xG/90': p => number(per90(p.xg, p.minutes), 2),
    'xA/90': p => number(per90(p.xa, p.minutes), 2), 'Indice': p => number(estimates.get(p.id).index),
    'Fantapunti attesi': p => number(estimates.get(p.id).expectedPoints, 2),
    'Metodo della stima': p => html(projectionLabel(estimates.get(p.id).projection?.method)),
    'Fantamedia Excel': p => { const stats = leagueStats().get(p.id); return stats?.fantasyAverage == null ? '—'
      : `${number(stats.fantasyAverage, 2)} · ${number(stats.gamesWithVote)} voti`; },
    'Avversario della giornata': p => html(context.get(p.id)?.fixtureLabel ?? '—')
  };
  return `<section class="panel stacked"><div class="panel-head"><h2>Confronto</h2><button data-clear-comparison>Deseleziona tutti</button></div>
    <div class="table-wrap"><table><thead><tr><th>Statistica</th>${candidates.map(p => `<th class="numeric">${html(p.name)}</th>`).join('')}</tr></thead><tbody>
    ${Object.entries(metrics).map(([label, value]) => `<tr><th scope="row">${label}</th>${candidates.map(p => `<td class="numeric">${value(p)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
}
function giocatori() {
  return renderGiocatori({
    dataset, mode, heading, html, filters, ROLES, playerList, comparison
  });
}
function stat(label, value) {
  return `<div class="detail-stat"><small>${label}</small><strong>${value}</strong></div>`;
}
function historyChart(rows, fields, labels, baseMax = 1, title = 'Andamento') {
  const data = rows.filter(row => Number.isInteger(row.round)).sort((a,b) => a.round - b.round).slice(-10);
  if (!data.some(row => fields.some(key => Number.isFinite(row[key])))) return empty('Nessun valore storico acquisito.');
  const values = data.flatMap(row => fields.map(key => row[key]).filter(Number.isFinite));
  const max = Math.max(baseMax, ...values) * 1.13;
  const min = Math.min(0, ...values) * 1.13;
  const from = data[0].round;
  const to = data.at(-1).round;
  const x = r => from === to ? 266 : 38 + 456 * (r - from) / (to - from);
  const y = v => 111 - (v - min) * 89 / (max - min);
  const colors = ['#b9fa68', '#b8bdfd'];
  const lines = fields.map((key, series) => data.map((row, index) => {
    const value = row[key];
    if (!Number.isFinite(value)) return '';
    const previous = data[index - 1];
    const point = `<circle cx="${x(row.round)}" cy="${y(value)}" r="4" fill="${colors[series]}"><title>G${row.round} · ${labels[series]} ${number(value, 2)}</title></circle>`;
    return previous?.round === row.round - 1 && Number.isFinite(previous[key])
      ? `<line x1="${x(previous.round)}" y1="${y(previous[key])}" x2="${x(row.round)}" y2="${y(value)}" stroke="${colors[series]}" stroke-width="2"/>${point}` : point;
  }).join('')).join('');
  return `<svg class="player-chart" viewBox="0 0 532 141" role="img" aria-label="${html(title)}">
    <path d="M38 31h456m-456 40h456m-456 40h456" fill="none" stroke="#34443a"/>
    ${lines}
    ${data.map(row => `<text x="${x(row.round)}" y="130" fill="#a1aea7" font-size="11" text-anchor="middle">G${row.round}</text>`).join('')}
  </svg><div class="legend">${labels.map(label => `<span>${label}</span>`).join('')}</div>
  <details><summary>Valori del grafico</summary><div class="table-wrap"><table><thead><tr><th>Giornata</th>${labels.map(label => `<th class="numeric">${label}</th>`).join('')}</tr></thead><tbody>
  ${data.map(row => `<tr><td>G${row.round}</td>${fields.map(field => `<td class="numeric">${number(row[field], 2)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}
function showPlayer(id) {
  const p = getPlayer(id);
  if (!p) return;
  const a = playerAnalysis(p);
  const games = p.history ?? [];
  const votes = p.ratings ?? [];
  const excel = leagueStats().get(id);
  const localVotes = mode === 'real' ? votesByPlayer.get(p.id) : undefined;
  const ratingValues = votes.map(row => row.rating).filter(Number.isFinite);
  const fantasyValues = votes.map(row => row.fantasyRating).filter(Number.isFinite);
  const average = values => values.length ? values.reduce((sum,value) => sum + value,0) / values.length : null;
  const availabilityLabels = { out: 'Indisponibile', doubtful: 'In dubbio', available: 'Disponibile', reported: 'Segnalata', unknown: 'Mancante' };
  const availability = a.availability?.status ?? 'unknown';
  const projected = a.projection;
  const components = a.components.filter(c => Number.isFinite(c.value));
  const added = modeState().roster.includes(p.id);
  const opponent = a.fixture ? getTeam(a.fixture.homeId === p.teamId ? a.fixture.awayId : a.fixture.homeId) : null;
  dialog.innerHTML = `<button class="dialog-close" data-close-dialog aria-label="Chiudi scheda">✕</button>
    <div class="eyebrow">${mode === 'demo' ? 'Demo · ' : ''}${html(getTeam(p.teamId)?.shortName)} · ${ROLES[p.position] ?? 'Ruolo mancante'}</div><h2 id="player-title">${html(p.name)}</h2>
    ${mode === 'real' ? `<details class="dialog-section"><summary>ID FantaLab</summary><p><code>${html(p.id)}</code></p></details>` : ''}
    ${p.id.startsWith('csv:') ? '<p class="inline-status">Nome, squadra e ruolo provengono dal tuo CSV. Le statistiche di listone sono mancanti.</p>' : ''}
    <div class="detail-grid">
      ${stat('Minuti', number(p.minutes))}${stat('Presenze', number(p.appearances))}${stat('Gol', number(p.goals))}${stat('Assist', number(p.assists))}
      ${stat('xG', number(p.xg, 2))}${stat('xA', number(p.xa, 2))}${stat('xG / 90', number(per90(p.xg, p.minutes), 2))}${stat('xA / 90', number(per90(p.xa, p.minutes), 2))}
      ${stat('Tiri', number(p.shots))}${stat('npxG', number(p.npxg, 2))}${stat('Ammonizioni', number(p.yellowCards))}${stat('Titolarità', number(p.starts))}
    </div>
    ${excel ? `<section class="dialog-section"><h3>Statistiche del listone Excel</h3>
      <p>Fonte · Excel della lega${marketImports.listone?.asOfRound ? ` · fino alla G${marketImports.listone.asOfRound}` : ' · giornata del campione da confermare in Mercato'}</p>
      <div class="detail-grid">${stat('Partite a voto', number(excel.gamesWithVote))}${stat('Media voto', number(excel.averageRating, 2))}${stat('Fantamedia', number(excel.fantasyAverage, 2))}</div></section>` : ''}
    <div class="actions"><button data-add="${html(p.id)}" ${added ? 'disabled' : ''}>${added ? 'Nella tua rosa' : 'Aggiungi alla rosa'}</button></div>
    <section class="dialog-section"><h3>Schierabilità · Giornata ${round}</h3>
      <p class="muted">${opponent ? `Avversaria · ${html(opponent.shortName)} · ` : ''}Disponibilità ${html(availabilityLabels[availability] ?? 'Mancante')}${a.availability?.source === 'manual' ? ' · inserita manualmente' : ''}${a.availability?.reason ? ` · ${html(a.availability.reason)}` : ''}</p>
      <div class="detail-grid">${stat('Indice / 100', number(a.index))}${stat('Copertura', percent(a.coverage))}
      ${stat(Number.isFinite(projected?.voteProbability) ? 'Prob. di voto' : 'Prob. di giocare', percent(projected?.voteProbability ?? projected?.appearanceProbability))}
      ${stat('Fantapunti attesi', number(a.expectedPoints, 2))}</div>
      ${projected?.method ? status(projectionLabel(projected.method), 'partial') : ''}
      ${a.indexMethod === 'league-average' ? '<p class="muted">Indice basato sul campione di voti Excel.</p>' : ''}
      ${a.indexMethod === 'official-history' ? '<p class="muted">Indice basato sui voti di giornata importati.</p>' : ''}
      ${components.map(c => `<div class="duel"><strong>${html(c.label)} · ${number(c.value)}/100</strong><div class="meter" aria-hidden="true"><span style="width:${Math.min(100, Math.max(0, c.value))}%"></span></div><p>Peso effettivo ${number(c.effectiveWeight)}% · contributo ${number(c.contribution, 1)} punti. ${html(c.detail)}</p></div>`).join('')}
      ${a.notes.length ? `<ul class="muted">${a.notes.map(note => `<li>${html(note)}</li>`).join('')}</ul>` : ''}
    </section>
    ${renderManualAvailability({ player: p, round, record: manualAvailabilityFor(p.id), html })}
    <label class="field-label"><span><input type="checkbox" data-penalty-taker="${html(p.id)}" ${modeState().penaltyTakers.includes(p.id) ? 'checked' : ''}> Rigorista</span></label>
    ${officialPlayerHistory(p)}
    ${renderFixtureDifficulty(teamDifficulty(p.teamId), { html, number, compact: true })}
    ${games.length ? `<section class="dialog-section"><h3>xG e xA per giornata</h3>${historyChart(games, ['xg','xa'], ['xG','xA'], 1, 'Andamento xG e xA')}</section>` : ''}
    ${votes.length ? `<section class="dialog-section"><h3>Voto e fantavoto FantaTB</h3>
      <div class="detail-grid">${stat('Voti acquisiti',number(ratingValues.length))}${stat('Media voto acquisita',number(average(ratingValues),2))}
      ${stat('Fantavoti acquisiti',number(fantasyValues.length))}${stat('Fantamedia acquisita',number(average(fantasyValues),2))}</div>
      ${historyChart(votes, ['rating','fantasyRating'], ['Voto','Fantavoto'], 8, 'Andamento voti FantaTB')}</section>` : ''}
    ${localVotes ? ['2026/27','2025/26'].map(season => {
      const rows = localVotes.rows.filter(row => row.season === season);
      const scores = rows.map(row => row.fantasyRating).filter(Number.isFinite);
      return rows.length ? `<section class="dialog-section"><h3>Fantavoti della lega · ${season}</h3>
        <p>${html(localVotes.source)} · ${number(scores.length)} fantavoti su ${number(rows.length)} righe · fantamedia ${number(average(scores),2)}</p>
        ${historyChart(rows, ['rating','fantasyRating'], ['Voto','Fantavoto'], 8, 'Andamento fantavoti della lega')}</section>` : '';
    }).join('') : ''}
    ${!games.length && !votes.length && !localVotes ? '<p class="inline-status">Storico individuale mancante.</p>' : ''}
    ${!games.length && (votes.length || localVotes) ? '<p class="inline-status">Serie per giornata di xG e xA mancante.</p>' : ''}
    ${Number.isFinite(a.expectedPoints) && a.fixture ? `<section class="dialog-section"><button data-simulate-player="${html(p.id)}">Simula il calciatore</button><div id="individual-simulation" class="dialog-section" aria-live="polite"></div></section>` : ''}`;
  if (!dialog.open) {
    lastFocus = document.activeElement;
    dialog.showModal();
    $('.dialog-close').focus();
  }
}

let importReport;
function preset() {
  const demo = dataset.demoPreset;
  if (!demo || mode !== 'demo') return;
  const state = modeState();
  state.roster = [...new Set([...state.roster, ...demo.starters, ...demo.reserves])];
  const prior = state.lineups[demo.round];
  if (!prior?.starters.length && !prior?.reserves.length) {
    state.lineups[demo.round] = { formation: demo.formation, starters: [...demo.starters], reserves: [...demo.reserves], maxSubstitutions: 3 };
    lineupUndo.demo.delete(demo.round);
    notify('Rosa demo e formazione di esempio caricate.');
  } else notify('I giocatori demo sono in rosa. La formazione già salvata è stata conservata.');
  round = selectedRounds.demo = demo.round;
  invalidateLineupResults();
  lineupCopyPreview = false;
  save();
  render();
}
function addPlayer(id) {
  const p = getPlayer(id);
  if (!p || modeState().roster.includes(id)) return;
  modeState().roster.push(id);
  save();
  notify(`${p.name} aggiunto alla rosa.`);
}
function removePlayer(id) {
  const state = modeState();
  state.roster = state.roster.filter(value => value !== id);
  delete state.rosterLocals[id];
  for (const record of [...Object.values(state.lineups), ...Object.values(state.references), ...lineupUndo[mode].values()]) {
    record.starters = record.starters.filter(value => value !== id);
    record.reserves = record.reserves.filter(value => value !== id);
  }
  invalidateLineupResults();
  lineupCopyPreview = false;
  save();
  render();
  notify('Calciatore rimosso dalla rosa e dalle formazioni salvate.');
}
function lineupRoster() {
  return new Map(groupPlayers(modeState().roster).map(player => [player.id, player]));
}
function renderLineupChange(focus) {
  const scrollTop = $('.roster-list')?.scrollTop ?? 0;
  render();
  const rosterList = $('.roster-list');
  if (rosterList) rosterList.scrollTop = scrollTop;
  if (focus) focus()?.focus({ preventScroll: true });
}
function changeLineup(next, focus) {
  const state = modeState();
  lineupUndo[mode].set(round, lineupSnapshot(lineup()));
  state.lineups[round] = lineupSnapshot(next);
  lineupCopyPreview = false;
  invalidateLineupResults();
  save();
  renderLineupChange(focus);
}
function previousLineup() {
  const record = modeState().lineups[round - 1];
  if (!record) return null;
  const roster = lineupRoster();
  const starters = record.starters.filter(id => roster.has(id));
  const reserves = record.reserves.filter(id => roster.has(id));
  if (!starters.length && !reserves.length) return null;
  return {
    record: { ...record, starters, reserves },
    missing: record.starters.length + record.reserves.length - starters.length - reserves.length
  };
}
function lineupHasChanges(record) {
  return record.starters.length || record.reserves.length || record.formation !== '3-4-3' || record.maxSubstitutions !== 3;
}
function copyPreviousLineup(confirmCopy) {
  const previous = previousLineup();
  if (!previous) return;
  if (!confirmCopy && lineupHasChanges(lineup())) {
    lineupCopyPreview = true;
    renderLineupChange(() => $('[data-lineup-copy-confirm]'));
    return;
  }
  if (confirmCopy && !lineupCopyPreview) return;
  changeLineup(previous.record, () => $('[data-lineup-undo]'));
  const skipped = previous.missing ? ` ${previous.missing} calciatori non sono più disponibili nella rosa.` : '';
  notify(`Formazione copiata dalla giornata ${round - 1}.${skipped}`);
}
function undoLineupChange() {
  const previous = lineupUndo[mode].get(round);
  if (!previous) return;
  modeState().lineups[round] = previous;
  lineupUndo[mode].delete(round);
  lineupCopyPreview = false;
  invalidateLineupResults();
  save();
  renderLineupChange(() => $('[data-lineup-copy]:not(:disabled)') ?? $('#formation') ?? $('#simulation-form button'));
  notify('Ultima modifica alla formazione annullata.');
}
function applyLineupPlacement(id, target, focus) {
  const record = lineup();
  const roster = lineupRoster();
  const result = placeLineupPlayer(record, roster, id, target);
  if (result.error) {
    notify(result.error);
    if (focus) renderLineupChange(focus);
    return;
  }
  if (!result.starters) return;
  changeLineup({ ...record, starters: result.starters, reserves: result.reserves }, focus);
  const name = roster.get(id).name;
  if (result.replaced) notify(`${name} e ${result.replaced.name} scambiati.`);
  else if (target.role === 'starter') notify(`${name} in campo.`);
  else if (target.role === 'reserve') notify(`${name} in panchina.`);
  else notify(`${name} fuori formazione.`);
}
function setLineupRole(id, role) {
  applyLineupPlacement(id, { role }, () =>
    [...pageView.querySelectorAll('[data-lineup-role]')].find(element => element.dataset.lineupRole === id));
}
function moveReserve(id, direction) {
  const reserves = lineup().reserves;
  const index = reserves.indexOf(id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= reserves.length) return;
  applyLineupPlacement(id, { role: 'reserve', playerId: reserves[next], after: direction > 0 }, () => {
    const buttons = [...pageView.querySelectorAll('[data-reserve]:not(:disabled)')];
    return buttons.find(button => button.dataset.reserve === id && Number(button.dataset.move) === direction)
      ?? buttons.find(button => button.dataset.reserve === id);
  });
}
function lineupDropTarget(element) {
  const { lineupDrop: role, dropPosition: position, dropPlayer: playerId } = element.dataset;
  return { role, position, playerId };
}
function setLineupSelection(id) {
  lineupSelection = id === lineupSelection ? undefined : id;
  const picked = lineupSelection && getPlayer(lineupSelection);
  const roster = lineupRoster();
  const record = lineup();
  for (const handle of pageView.querySelectorAll('[data-lineup-drag]')) {
    handle.setAttribute('aria-pressed', String(handle.dataset.lineupDrag === lineupSelection));
  }
  for (const zone of pageView.querySelectorAll('[data-lineup-drop]')) {
    const canPlace = picked && placeLineupPlayer(record, roster, picked.id, lineupDropTarget(zone)).starters;
    zone.classList.toggle('is-lineup-tap-target', Boolean(canPlace));
  }
  $('#lineup-selection').textContent = picked ? `${picked.name} selezionato. Scegli una destinazione.` : '';
}
function dragAttributes(player) {
  return `data-lineup-drag="${html(player.id)}" data-drag-label="${html(player.name)}" aria-pressed="false"`;
}
function lineupContextLabel(context, compact = false) {
  if (!context) return '';
  const { availability, fixtureLabel, opponentName, venue, manual } = context;
  const fixture = compact && opponentName && venue ? `${opponentName} · ${venue === 'Casa' ? 'C' : 'T'}` : fixtureLabel;
  const manualLabel = lineupManualLabel(manual);
  const label = manualLabel ? `${manualLabel} · manuale` : compact && availability.status === 'unknown' ? 'Disp. da verificare' : availability.label;
  return `<small class="lineup-player-context" data-availability="${html(availability.status)}">
    <span>${html(fixture)}</span><span class="${manualLabel ? 'lineup-manual' : ''}" title="${html(manual?.reason ?? availability.reason ?? availability.label)}">${html(label)}</span>${context.penaltyTaker ? '<span>Rigorista</span>' : ''}</small>`;
}
function pitch(record, validation, context) {
  return `<div class="pitch" role="group" aria-label="Formazione ${html(record.formation)} sul campo">${['FWD', 'MID', 'DEF', 'GK'].map(role => {
    const picked = groupPlayers(record.starters).filter(p => p.position === role);
    const missing = Math.max(0, (validation.required[role] ?? 0) - picked.length);
    return `<div class="pitch-row" aria-label="${ROLES[role]}">${picked.map(p => `<button type="button" class="pitch-player" ${dragAttributes(p)} data-lineup-drop="starter" data-drop-position="${role}" data-drop-player="${html(p.id)}"><span aria-hidden="true">${SHORT[role]}</span><span>${html(p.name)}</span>${lineupContextLabel(context.get(p.id), true)}</button>`).join('')}
      ${Array.from({ length: missing }, (_, index) => `<button type="button" class="pitch-player vacant" data-lineup-drop="starter" data-drop-position="${role}" aria-label="${ROLES[role]} · posto libero ${index + 1}"><span aria-hidden="true">${SHORT[role]}</span><span>Libero</span></button>`).join('')}</div>`;
  }).join('')}</div>`;
}
function rosa() {
  return renderRosa({
    modeState, lineup, groupPlayers, validateLineup, playerContexts, manualAvailabilityFor,
    previousLineup, dataset, mode, heading, html, getTeam, SHORT, dragAttributes, lineupContextLabel,
    status, empty, importReport, lineupUndo, round, suggestionPanel, lineupCopyPreview, FORMATION_OPTIONS,
    pitch, iconSpan, officialArchive
  });
}
function playerContexts(players) {
  return buildLineupContext(players, { fixtures: dataset.fixtures, absences: dataset.absences, round,
    getTeam, getPlayerFixture, getAvailability: (player, fixture, absences) =>
      getAvailability(player, fixture, absences, manualAvailabilityFor(player.id)),
    isUpcoming: fixture => fixture.status === 'scheduled' && (mode === 'demo' || isPendingFixture(fixture)) });
}
function suggestionPanel() {
  if (!lineupSuggestion) return '';
  const { lineup: proposed, method, expectedPoints, gain, eligible, rosterCount, comparedModules, sample, reason } = lineupSuggestion;
  if (!proposed) return `<p class="notice neutral" role="status">${html(reason)} ${number(11 - lineupSuggestion.missingStarters)}/11 ruoli coperti nel miglior modulo.</p>`;
  return `<div class="notice neutral lineup-copy-preview" role="status">
    <strong>${html(proposed.formation)} · ${number(expectedPoints, 2)} fantapunti attesi</strong>
    <p>${html(projectionLabel(method))} · 11 titolari coperti · ${eligible}/${rosterCount} in rosa · ${comparedModules} moduli confrontati.
    ${sample.players ? ` Campione · ${sample.minimum}–${sample.maximum} osservazioni per titolare.` : ''}
    ${Number.isFinite(gain) ? ` Differenza attesa · ${gain >= 0 ? '+' : ''}${number(gain, 2)} prima delle sostituzioni.` : ''}</p>
    <details><summary>Undici e panchina proposti</summary><p>Titolari · ${html(groupPlayers(proposed.starters).map(p => p.name).join(', '))}</p>
    <p>Panchina · ${html(groupPlayers(proposed.reserves).map(p => p.name).join(', ')) || 'Nessuna riserva con stima'}</p></details>
    <button type="button" data-lineup-accept>Applica suggerimento</button></div>`;
}
function linkRosterPlayer(state, localId, id) {
  const replace = values => [...new Set(values.map(value => value === localId ? id : value))];
  state.roster = replace(state.roster);
  for (const record of [...Object.values(state.lineups), ...Object.values(state.references), ...lineupUndo[mode].values()]) {
    record.starters = replace(record.starters);
    record.reserves = replace(record.reserves).filter(value => !record.starters.includes(value));
  }
  delete state.rosterLocals[localId];
  invalidateLineupResults();
}
function importCsv(text) {
  const { entries, unresolved } = readRosterCsv(text, dataset);
  const state = modeState();
  let added = 0;
  let duplicates = 0;
  let localAdded = 0;
  let linked = 0;
  for (const { id, localId, local } of entries) {
    if (localId && id !== localId && state.rosterLocals[localId]) {
      linkRosterPlayer(state, localId, id);
      linked++;
    } else if (state.roster.includes(id)) {
      duplicates++;
    } else if (state.roster.length >= 1000) {
      unresolved.push({ label: local?.name ?? getPlayer(id)?.name ?? id, reason: 'Limite della rosa raggiunto' });
    } else {
      state.roster.push(id);
      added++;
      if (local) {
        state.rosterLocals[id] = local;
        localAdded++;
      }
    }
  }
  save();
  const counts = `${added} aggiunti, ${duplicates} già in rosa, ${unresolved.length} da verificare.`;
  const localSummary = localAdded ? ` ${localAdded} da CSV senza statistiche.` : '';
  const linkedSummary = linked ? ` ${linked} voci da CSV collegate al listone.` : '';
  return { message: counts + localSummary + linkedSummary, unresolved };
}
async function restoreBackup(text) {
  const file = JSON.parse(text);
  if (file?.schemaVersion !== 1 || file.season !== '2026/27' || !file.state || typeof file.state !== 'object') {
    throw new Error('Questo file non è un backup FantaLab Pro 2026/27.');
  }
  const incoming = sanitizeBackup(file.state);
  if (file.officialVotes) {
    if (!officialLoaded || officialBusy) throw new Error('Attendi che l’archivio voti sia disponibile e riprova.');
    const imported = cleanOfficialArchive(file.officialVotes);
    if (!Array.isArray(file.officialVotes.days) || imported.days.length !== file.officialVotes.days.length) {
      throw new Error('Il backup contiene un archivio voti non valido.');
    }
    officialBusy = true;
    try {
      const days = new Map(imported.days.map(day => [`${day.season}:${day.round}`,day]));
      for (const day of officialArchive.days) days.set(`${day.season}:${day.round}`,day);
      await updateOfficialArchive({ edition: officialArchive.days.length ? officialArchive.edition : imported.edition, days:[...days.values()] });
    } finally { officialBusy = false; }
  }
  let kept = 0;
  for (const m of ['real', 'demo']) {
    const base = storage[m];
    base.roster = [...new Set([...(base.roster ?? []), ...(incoming[m].roster ?? [])])];
    base.rosterLocals = { ...incoming[m].rosterLocals, ...base.rosterLocals };
    base.availability ??= {};
    base.forecasts = { ...incoming[m].forecasts, ...base.forecasts };
    base.penaltyTakers = [...new Set([...(base.penaltyTakers ?? []), ...(incoming[m].penaltyTakers ?? [])])];
    base.scoring ??= incoming[m].scoring;
    for (const [day, reports] of Object.entries(incoming[m].availability ?? {})) {
      base.availability[day] = { ...reports, ...base.availability[day] };
    }
    base.lineups ??= {};
    base.references ??= {};
    for (const [day, record] of Object.entries(incoming[m].lineups ?? {})) {
      const existing = base.lineups[day];
      if (existing && (existing.starters.length || existing.reserves.length)) kept++;
      else {
        base.lineups[day] = record;
        lineupUndo[m].delete(Number(day));
        base.roster = [...new Set([...base.roster, ...record.starters, ...record.reserves])];
      }
    }
    for (const [day, record] of Object.entries(incoming[m].references ?? {})) {
      if (base.references[day]) continue;
      base.references[day] = record;
      base.roster = [...new Set([...base.roster, ...record.starters, ...record.reserves])];
    }
  }
  invalidateLineupResults();
  lineupCopyPreview = false;
  save();
  return kept ? `Backup unito. ${kept} formazioni già presenti sono state conservate.` : 'Backup importato e unito alle rose salvate.';
}
function download(content, name, type) {
  const href = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 3000);
}

function readVotesImport() {
  try {
    const saved = JSON.parse(localStorage.getItem(VOTES_KEY) ?? 'null');
    return saved && typeof saved.source === 'string' && saved.source.length <= 80 &&
      Array.isArray(saved.rows) && saved.rows.length <= 20_000 &&
      saved.rows.every(row => typeof row?.id === 'string' && Number.isInteger(row.round)) ? saved : null;
  } catch { return null; }
}
function indexVotes(imported) {
  const index = new Map();
  for (const row of imported?.rows ?? []) {
    const sample = index.get(row.id) ?? { source: imported.source, rows: [] };
    sample.rows.push(row);
    index.set(row.id, sample);
  }
  return index;
}
function setVotesImport(imported) {
  votesImport = imported;
  votesByPlayer = indexVotes(imported);
  invalidateLineupResults();
  try {
    if (imported) localStorage.setItem(VOTES_KEY, JSON.stringify(imported));
    else localStorage.removeItem(VOTES_KEY);
    return true;
  } catch { return false; }
}
function officialVoteIndex() {
  const scoring = modeState().scoring;
  if (officialCache?.archive !== officialArchive || officialCache.scoring !== scoring) {
    officialCache = { archive:officialArchive, scoring, index:buildOfficialVoteIndex(officialArchive.days, {
      edition:officialArchive.edition, scoring:sanitizeScoring(scoring)
    }) };
  }
  return officialCache.index;
}
function officialSourceKey(official) {
  return `${official.sourceId}:${JSON.stringify(Object.values(sanitizeScoring(modeState().scoring)))}`;
}
async function openOfficialArchive() {
  try { officialArchive = await readOfficialArchive(); }
  catch { officialMessage = 'L’archivio locale non è accessibile in questo browser.'; }
  officialLoaded = true;
  if (dataset && mode === 'real') {
    invalidateLineupResults();
    render();
  }
}
async function updateOfficialArchive(next) {
  const checked = cleanOfficialArchive(next);
  if (checked.days.length !== next.days.length) throw new Error('Archivio voti non valido.');
  try {
    const revision = await writeOfficialArchive(checked, officialArchive.revision);
    officialArchive = { ...checked, revision };
  } catch (error) {
    if (error.code === 'ARCHIVE_CHANGED') {
      officialArchive = await readOfficialArchive();
      invalidateLineupResults();
    }
    throw error;
  }
  invalidateLineupResults();
}
function officialBindingContext() {
  return {
    current:dataset,
    players:[...dataset.players,...Object.values(storage.real.rosterLocals ?? {})],
    listone:marketImports.listone?.rows
  };
}
function officialBinding(season, { current, players, listone } = officialBindingContext()) {
  const currentSeason = season === current.season;
  const teams = currentSeason ? current.teams : historicalArchive?.teams;
  if (!teams?.length) throw new Error('Archivio delle squadre della stagione precedente non disponibile.');
  return { teams, players, listone:currentSeason ? listone : [] };
}
async function importOfficialFiles(files, confirmedSeason) {
  if (mode !== 'real' || !officialLoaded || officialBusy || !files.length) return;
  if (files.length > 38) {
    officialMessage = 'Carica al massimo 38 file alla volta.';
    refreshOfficialPanel();
    return;
  }
  const binding = officialBindingContext();
  const currentSeason = binding.current.season;
  officialBusy = true;
  officialPending = undefined;
  officialMessage = 'Lettura dei file nel browser…';
  refreshOfficialPanel();
  try {
    const days = new Map(officialArchive.days.map(day => [`${day.season}:${day.round}`, day]));
    const issues = [];
    let imported = 0;
    let replaced = 0;
    const pending = [];
    for (const file of files) {
      try {
        if (!/\.xlsx$/i.test(file.name) || file.size > 8_000_000) throw new Error('Usa un file XLSX fino a 8 MB.');
        const detected = officialVotesSeason(file.name);
        if (!confirmedSeason && detected !== currentSeason) { pending.push(file); continue; }
        const season = confirmedSeason ?? currentSeason;
        if (detected && detected !== season) throw new Error(`Il nome del file indica la stagione ${detected}. Conferma la stagione corrispondente.`);
        if (season !== currentSeason) await loadHistoricalArchive();
        const day = await readOfficialVotesWorkbook(await file.arrayBuffer(), {
          filename:file.name, season:currentSeason, confirmedSeason, ...officialBinding(season,binding)
        });
        const key = `${day.season}:${day.round}`;
        if (days.has(key)) replaced++;
        days.set(key, day);
        imported++;
      } catch (error) { issues.push(`${file.name.slice(0,100)} · ${error.message}`); }
    }
    if (imported) await updateOfficialArchive({ ...officialArchive, days:[...days.values()] });
    officialPending = pending.length ? pending : undefined;
    const summary = imported ? `${imported} giornate importate${replaced ? ` · ${replaced} sostituite` : ''}.` : '';
    officialMessage = [summary, ...issues].filter(Boolean).join(' ');
  } catch (error) { officialMessage = error.message; }
  finally {
    officialBusy = false;
    refreshOfficialPanel();
  }
}
function refreshOfficialPanel() {
  const panel = $('#official-votes-panel');
  if (panel) panel.outerHTML = officialVotesPanel();
}
async function updateOfficialSettings({ edition, remove, relink }) {
  if (!officialLoaded || officialBusy) return;
  officialBusy = true;
  try {
    let days = officialArchive.days;
    if (remove) days = days.filter(day => `${day.season}:${day.round}` !== remove);
    if (relink) days = days.map(day => {
      if (day.season !== dataset.season) return day;
      return { ...day, ...bindOfficialVoteRows(day.rows, { ...officialBinding(day.season), readRows:day.readRows }) };
    });
    await updateOfficialArchive({ edition:edition ?? officialArchive.edition, days });
    officialMessage = remove ? 'Giornata rimossa.' : relink ? 'Abbinamenti aggiornati.' : 'Redazione salvata.';
  } catch (error) { officialMessage = error.message; }
  finally {
    officialBusy = false;
    refreshOfficialPanel();
  }
}
function officialVotesPanel() {
  const days = [...officialArchive.days].sort((first, second) => second.season.localeCompare(first.season) || second.round - first.round);
  const latest = days.find(day => day.season === dataset.season);
  return `<section class="panel stacked official-votes" id="official-votes-panel"><div class="panel-head">
    <div><h2>Voti di giornata Fantacalcio.it</h2><p>File ad uso personale: restano nel tuo browser.</p></div>
    ${latest ? status(`Voti caricati fino alla giornata ${latest.round}`, 'available') : ''}</div>
    <div class="form-fields"><label class="field-label">Redazione della lega<select id="official-votes-edition" ${officialBusy || !officialLoaded ? 'disabled' : ''}>
      ${OFFICIAL_VOTE_EDITIONS.map(edition => `<option ${edition === officialArchive.edition ? 'selected' : ''}>${edition}</option>`).join('')}</select></label>
      <label class="btn button-file">Carica Excel voti<input id="official-votes-files" aria-label="Carica Excel voti" type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ${officialBusy || !officialLoaded ? 'disabled' : ''}></label>
      ${days.length ? '<button type="button" data-official-relink>Ricollega al listone</button>' : ''}</div>
    <div id="official-votes-drop" class="official-drop">Trascina qui uno o più file XLSX scaricati da Fantacalcio.it.</div>
    ${officialPending ? `<form id="official-votes-confirm" class="form-fields"><label class="field-label">Conferma stagione di ${officialPending.length} file
      <select id="official-votes-season" name="season"><option value="">Scegli stagione</option>
      <option>2026/27</option><option>2025/26</option></select></label><button type="submit">Importa file confermati</button>
      <button type="button" data-official-cancel>Annulla</button></form>` : ''}
    ${officialMessage ? `<p class="inline-status" role="status">${html(officialMessage)}</p>` : ''}
    ${days.map(day => {
      const ambiguous = day.unmatched.filter(row => row.ambiguous).length;
      const matched = day.rows.filter(row => row.id).length;
      return `<div class="duel official-day"><div class="panel-head"><div><h3>Giornata ${day.round} · ${html(day.season)}</h3>
      <p>${day.complete ? 'Completa' : 'Parziale'} · ${day.teamIds.length}/20 squadre · ${html(officialArchive.edition)}</p></div>
      <button type="button" data-official-remove="${day.season}:${day.round}" aria-label="Rimuovi voti giornata ${day.round} ${day.season}">Rimuovi</button></div>
      <p>${day.readRows} letti · ${matched} abbinati · ${day.unmatched.length - ambiguous} non abbinati · ${ambiguous} ambigui · ${day.ignoredCoaches} allenatori esclusi.</p>
      ${Number.isFinite(day.codeCoverage) ? `<p>Codici coerenti con il listone · ${number(day.codeCoverage * 100,2)}%.</p>` : ''}
      ${day.warnings.map(warning => `<p class="inline-status">${html(warning)}</p>`).join('')}
      ${day.unmatched.length ? `<details><summary>Righe da verificare</summary><ul>${day.unmatched.map(row =>
        `<li>${html(row.name)} · ${html(getTeam(row.teamId)?.shortName ?? row.teamId)} · ${html(row.reason)}</li>`).join('')}</ul></details>` : ''}</div>`;
    }).join('')}
  </section>`;
}
const OFFICIAL_EVENT_LABELS = {
  goals:'Gol', penaltyScored:'Rigore segnato', penaltySaved:'Rigore parato', penaltyMissed:'Rigore sbagliato',
  ownGoal:'Autogol', goalsConceded:'Gol subiti', yellowCard:'Ammonizione', redCard:'Espulsione', assist:'Assist'
};
function officialPlayerHistory(player) {
  if (mode !== 'real' || !officialArchive.days.length) return '';
  const index = officialVoteIndex();
  const current = index.history(player, dataset.season);
  const historic = index.history(player, '2025/26');
  const rows = [...current, ...historic];
  if (!rows.length) return '';
  const candidate = current.some(row => row.events?.penaltyScored + row.events?.penaltyMissed > 0);
  const chart = (season, observations) => observations.length ? `<h4>${season} · ${observations.filter(row => Number.isFinite(row.rating)).length}/${observations.length} a voto</h4>
      ${historyChart(observations, ['rating','fantasyRating'], ['Voto','Fantavoto'], 8, `Andamento voti ${season}`)}
      <div class="table-wrap" tabindex="0" role="region" aria-label="Eventi di giornata ${season}"><table><thead><tr><th>Giornata</th><th>Voto</th><th>Fantavoto</th><th>Eventi</th></tr></thead><tbody>
      ${observations.map(row => `<tr><th scope="row">G${row.round}</th><td>${row.rating === null ? 'SV' : number(row.rating,1) + (row.starred ? '*' : '')}</td>
        <td>${number(row.fantasyRating,2)}</td><td>${row.events ? Object.entries(row.events).filter(([,count]) => count > 0).map(([key,count]) => `${OFFICIAL_EVENT_LABELS[key]} ×${count}`).join(' · ') || '—' : '—'}</td></tr>`).join('')}
      </tbody></table></div>` : '';
  return `<section class="dialog-section official-player-history"><h3>Voti di giornata Fantacalcio.it</h3>
    <p>${html(index.source)}. Fantavoto calcolato con il regolamento Classic salvato.</p>
    ${candidate ? '<p>Possibile rigorista dai rigori segnati o sbagliati acquisiti. Puoi confermare con il flag Rigorista.</p>' : ''}
    ${rows.some(row => row.starred) ? '<p>Il significato dell’asterisco non è documentato nel file. Questi voti sono esclusi dal calcolo della variabilità.</p>' : ''}
    ${chart(dataset.season,current)}${chart('2025/26',historic)}</section>`;
}
function votesPanel() {
  return `<section class="panel"><div class="panel-head"><h2>Fantavoti della lega</h2>
    ${votesImport ? status(`${number(votesImport.rows.length)} righe`, 'available') : ''}</div>
    <p>Carica un CSV con una riga per giocatore e giornata. Usa un solo regolamento di voto per file. I dati restano nel browser. Un nuovo file sostituisce quello caricato.</p>
    <div class="form-fields"><label class="field-label">Fonte dei fantavoti<input id="votes-source" maxlength="80" placeholder="Es. Redazione della lega" value="${html(votesImport?.source)}"></label>
    <label class="btn button-file">Carica CSV<input id="votes-csv" type="file" accept=".csv,text/csv" aria-label="Carica CSV fantavoti"></label></div>
    <div class="actions"><button data-votes-template>Scarica modello CSV</button>${votesImport ? '<button data-votes-clear>Rimuovi fantavoti</button>' : ''}</div>
    <p class="inline-status">Un campo Fantavoto vuoto o SV indica una riga senza voto. Per il 2025/26 usa l’ID FantaLab della scheda del giocatore. I voti della stagione precedente sono consultabili nelle schede.</p>
    ${votesReport ? `<p role="status">${html(votesReport.message)}</p>
      ${votesReport.unresolved?.length ? `<details><summary>Righe da verificare</summary><ul>${votesReport.unresolved.slice(0,30)
        .map(row => `<li>Riga ${row.line} · ${html(row.label)} · ${html(row.reason)}</li>`).join('')}</ul></details>` : ''}` : ''}</section>`;
}
async function importVotesFile(file, source) {
  const version = ++votesImportVersion;
  try {
    if (!source) throw new Error('Indica la fonte dei fantavoti prima di caricare il CSV.');
    if (file.size > 2_000_000) throw new Error('Il file supera 2 MB.');
    const bytes = await file.arrayBuffer();
    if (version !== votesImportVersion || mode !== 'real') return;
    const players = [...dataset.players, ...Object.values(modeState().rosterLocals ?? {})];
    const { entries, unresolved } = readVotesCsv(decodeRosterCsv(bytes), { players, teams: dataset.teams });
    const saved = entries.length ? setVotesImport({ source, rows: entries }) : true;
    votesReport = { message: entries.length
      ? `${number(entries.length)} righe importate · ${number(unresolved.length)} da verificare.${saved ? '' : ' Dati disponibili solo in questa sessione.'}`
      : 'Nessuna riga valida nel CSV.', unresolved };
  } catch (error) { votesReport = { message: error.message }; }
  if (page === 'analisi' && mode === 'real') render();
}

const PROJECTION_LABELS = {
  'official-history': 'Voti di giornata Fantacalcio.it',
  'league-history': 'Fantavoti CSV della lega',
  'fantatb-history': 'Storico FantaTB',
  'league-average': 'Fantamedia Excel',
  'confirmed-out': 'Assenza confermata',
  events: 'Statistiche di gioco'
};
function projectionLabel(method) { return PROJECTION_LABELS[method] ?? 'Metodo mancante'; }

function validLineup(record) {
  return Boolean(record && validateLineup(groupPlayers(record.starters), record.formation).valid);
}
function lineupComparisonPanel() {
  const reference = modeState().references[round];
  const canSave = validLineup(lineup());
  return renderLineupComparison({ reference, result: lineupComparisonResult, html, number, percent, projectionLabel,
    canSave, canCompare: canSave && validLineup(reference) });
}
function updateComparisonPanel(focus) {
  const panel = $('[data-lineup-comparison]');
  if (!panel) return;
  panel.outerHTML = lineupComparisonPanel();
  if (focus) $(focus)?.focus({ preventScroll: true });
}
function handleLineupReference(action) {
  const state = modeState();
  const record = lineup();
  if (action === 'save' && validLineup(record)) {
    state.references[round] = lineupSnapshot(record);
    lineupComparisonResult = undefined;
    save();
    updateComparisonPanel('[data-lineup-reference="save"]');
    notify('Formazione di riferimento salvata.');
  }
  if (action === 'restore' && state.references[round]) {
    changeLineup(state.references[round], () => $('[data-lineup-undo]'));
    notify('Formazione di riferimento ripristinata.');
  }
}
function simulationFor(form) {
  const data = new FormData(form);
  const options = { dataset, mode, round, iterations: Number(data.get('iterations')), seed: Number(data.get('seed')), asOf: Date.now(),
    fantasySamples: mode === 'real' ? leagueFantasySamples() : undefined,
    leagueVotesByPlayer: mode === 'real' ? votesByPlayer : undefined, ...scoringOptions() };
  return record => simulateLineup(groupPlayers(record.starters), {
    ...options, formation: record.formation, reserves: groupPlayers(record.reserves), maxSubstitutions: record.maxSubstitutions
  });
}
function scoringOptions() {
  const predictions = new Map();
  const prior = mode === 'real' ? historicalArchive?.fixtures : undefined;
  return {
    scoring: modeState().scoring, manualAvailability: roundAvailability(), penaltyTakers: new Set(modeState().penaltyTakers),
    officialVotes: mode === 'real' ? officialVoteIndex() : undefined,
    fixtureScore(fixture) {
      if (!predictions.has(fixture.id)) predictions.set(fixture.id, matchScoreSampler(predictMatch(fixture, dataset.fixtures, prior)));
      return predictions.get(fixture.id);
    }
  };
}
const SCORING_LABELS = {
  goal: 'Gol', assist: 'Assist', yellowCard: 'Ammonizione', redCard: 'Espulsione', goalkeeperConceded: 'Gol subito dal portiere',
  penaltyScored: 'Rigore segnato', penaltyMissed: 'Rigore sbagliato', penaltySaved: 'Rigore parato',
  cleanSheet: 'Porta inviolata', ownGoal: 'Autogol', defenseAt6: 'Bonus da 6', defenseAt65: 'Bonus da 6,5', defenseAt7: 'Bonus da 7'
};
function scoringPanel() {
  const rules = sanitizeScoring(modeState().scoring);
  return `<details class="panel stacked"><summary>Regolamento Classic</summary>
    <p class="inline-status">Questi valori si applicano all’Excel di giornata e alla simulazione per eventi quando il dato è disponibile. I fantavoti già calcolati dalla fonte mantengono il proprio punteggio. Per attivare il bonus porta inviolata, inserisci il valore previsto dalla lega.</p>
    <form id="classic-scoring"><div class="scoring-fields">${Object.entries(SCORING_LABELS).map(([key, label]) =>
      `<label class="field-label">${label}<input type="number" name="${key}" min="-30" max="30" step="0.01" required value="${rules[key]}"></label>`).join('')}</div>
    <div class="form-fields">
      <label><input type="checkbox" name="defenseModifier" ${rules.defenseModifier ? 'checked' : ''}> Modificatore di difesa</label>
      <label><input type="checkbox" name="defenseIncludesKeeper" ${rules.defenseIncludesKeeper ? 'checked' : ''}> Includi il portiere</label>
    </div><button type="submit">Salva regolamento</button></form></details>`;
}
function runLineupComparison() {
  const form = $('#simulation-form');
  const reference = modeState().references[round];
  const record = lineup();
  if (!validLineup(reference) || !validLineup(record) || !form?.reportValidity()) return;
  lineupComparisonResult = compareLineups(reference, record, simulationFor(form));
  updateComparisonPanel('[data-lineup-compare]');
}

function simulatorOutput(result, single = false) {
  if (!result) return empty('I risultati compariranno dopo aver avviato la simulazione.');
  const exclusions = result.excluded?.length ? `<details><summary>Esclusioni per dati insufficienti (${result.excluded.length})</summary><ul>${result.excluded.map(item => `<li>${html(item.name)} · ${html(item.reason)}</li>`).join('')}</ul></details>` : '';
  const notes = result.notes?.length ? `<ul class="muted">${result.notes.map(note => `<li>${html(note)}</li>`).join('')}</ul>` : '';
  if (!Number.isFinite(result.mean)) return `<div class="notice neutral"><strong>Simulazione non disponibile</strong> Verifica la giornata e le esclusioni qui sotto. In Dati reali puoi integrare il campione con il <a class="text-link" href="#mercato">listone Excel della lega</a>.</div>${notes}${exclusions}`;
  const max = Math.max(1, ...result.histogram.map(bin => bin.count));
  const methods = Object.entries(result.methods ?? {}).filter(([,count]) => count > 0);
  const mixed = methods.length > 1;
  const partial = result.status === 'partial';
  return `<div class="panel-head"><div><h2>Distribuzione dei fantapunti</h2><p>${number(result.iterations)} scenari · seed ${html(result.seed)} · copertura titolari ${percent(result.coverage)}</p></div>
  ${status(mode === 'demo' ? 'Demo' : partial ? 'Stima parziale' : 'Stima', mode === 'demo' ? 'demo' : 'partial')}</div>
  ${methods.length ? `<p>Metodi impiegati · ${methods.map(([method,count]) => `${projectionLabel(method)} (${number(count)})`).join(' · ')}.</p>` : ''}
  ${mixed ? '<p class="inline-status">I dati provengono da metodi diversi e possono riflettere regole di voto diverse.</p>' : ''}
  <div class="detail-grid">${stat('Media',number(result.mean,2))}${stat('10° percentile',number(result.p10,1))}${stat('Mediana',number(result.p50,1))}${stat('90° percentile',number(result.p90,1))}</div>
  <p>Il 10° e il 90° percentile delimitano l’intervallo centrale dell’80% degli scenari.</p>
  <div class="histogram" aria-label="Frequenza per fascia di fantapunti">${result.histogram.map(bin => `<div class="hist-row"><span>${html(bin.label)}</span><div class="meter" aria-hidden="true"><span style="width:${100 * bin.count / max}%"></span></div><span>${percent(bin.count / result.iterations)}</span></div>`).join('')}</div>
  ${notes + exclusions}
  ${single ? '' : `<div class="duel"><h3>Contributi individuali</h3><div class="table-wrap" tabindex="0" role="region" aria-label="Contributi individuali"><table><thead><tr><th>Calciatore</th><th>Impiego</th><th>Metodo</th><th class="numeric">Fantapunti medi</th><th class="numeric">Utilizzato</th></tr></thead><tbody>
  ${result.individual.map(row => `<tr><td>${html(row.name)}</td><td>${row.role === 'starter' ? 'Titolare' : 'Panchina'}</td><td>${projectionLabel(row.method)}</td><td class="numeric">${number(row.mean,2)}</td><td class="numeric">${percent(row.usedProbability)}</td></tr>`).join('')}</tbody></table></div></div>`}`;
}
function simulazione() {
  return renderSimulazione({
    lineup, groupPlayers, validateLineup, playerAnalysis, heading, html, mode, marketImports,
    simulationResult, number, lineupUndo, round, dataset, lineupSimulationOutput, lineupComparisonPanel,
    scoringPanel
  });
}
function canArchiveForecast() {
  const games = byRound();
  return Number.isFinite(simulationResult?.mean) && games.length > 0 &&
    games.every(fixture => fixture.status === 'scheduled' && (mode === 'demo' || isPendingFixture(fixture)));
}
function lineupSimulationOutput() {
  return simulatorOutput(simulationResult) + (canArchiveForecast() ? `<div class="actions forecast-actions">
    <button type="button" data-save-forecast>${modeState().forecasts[round] ? 'Aggiorna previsione salvata' : 'Salva previsione'}</button>
    <a class="btn quiet" href="#rendimento">Vai al rendimento</a></div>` : '');
}
function saveForecast() {
  if (!canArchiveForecast()) return;
  const record = lineup();
  const entries = new Map(simulationResult.individual.map(row => [row.id,row]));
  const players = ids => groupPlayers(ids).map(({ id, name, position }) => ({ id, name, position, expectedPoints:entries.get(id)?.mean ?? null }));
  const method = simulationResult.method;
  const official = method === 'official-history' ? officialVoteIndex() : null;
  const source = official?.source ?? (method === 'league-history' ? votesImport?.source : method === 'fantatb-history' ? 'FantaTB' : null);
  const forecast = { season:dataset.season, round, asOf:new Date().toISOString(),
    starters:players(record.starters).map(player => ({ ...player, teamId:getPlayer(player.id)?.teamId })),
    reserves:players(record.reserves), maxSubstitutions:record.maxSubstitutions, expectedPoints:simulationResult.mean,
    coverage:simulationResult.coverage, complete:!simulationResult.excluded.length && method !== 'events' && !(official && modeState().scoring?.defenseModifier),
    method, source, sourceId:official ? officialSourceKey(official) : method === 'fantatb-history' ? 'fantatb' : null };
  forecast.reserves = forecast.reserves.map(player => ({ ...player, teamId:getPlayer(player.id)?.teamId }));
  modeState().forecasts[round] = forecast;
  save();
  $('#simulation-output').innerHTML = lineupSimulationOutput();
  $('[data-save-forecast]')?.focus({preventScroll:true});
  notify('Previsione della giornata salvata.');
}
function realizedVote(player, day, season, basis) {
  if (basis === 'official') {
    const official = officialVoteIndex();
    const subject = { ...getPlayer(player.id), ...player };
    const row = official.record(subject, season, day);
    const match = dataset.fixtures.find(fixture => fixture.round === day && fixture.status === 'played' &&
      (fixture.homeId === row?.teamId || fixture.awayId === row?.teamId));
    return row && match ? { ...row, sourceId:officialSourceKey(official) } : undefined;
  }
  if (basis === 'csv') {
    const sample = votesByPlayer.get(player.id);
    const row = sample?.rows.find(item => item.round === day && item.season === season);
    return row && { fantasyRating:row.fantasyRating, source:sample.source };
  }
  const source = dataset.sources.find(item => item.id === 'transferbeat-ratings');
  if (!source?.archives?.some(item => item.round === day)) return undefined;
  const row = getPlayer(player.id)?.ratings?.find(item => item.round === day);
  if (row && (row.fantasyRating !== null || source.ambiguousRatings === 0)) {
    return { fantasyRating:row.fantasyRating, source:'FantaTB', sourceId:'fantatb' };
  }
}
function rendimento() {
  return renderRendimento({
    modeState, heading, votesByPlayer, officialArchive, evaluateLineupPerformance, mode, realizedVote,
    html, projectionLabel, date, percent, stat, number
  });
}
function fonti() {
  return renderFonti({
    dataset, safeUrl, html, date, heading, mode, coverageRows
  });
}

function readMarketSource(kind) {
  try {
    const source = JSON.parse(localStorage.getItem(MARKET_KEY + kind) ?? 'null');
    return source?.version === 1 && Array.isArray(source.rows) && source.rows.length <= 10000
      && source.rows.every(row => typeof row?.id === 'string' && typeof row.name === 'string')
      ? source : null;
  } catch { return null; }
}
function saveMarketSource(kind, source) {
  marketImports[kind] = source;
  marketCache = undefined;
  try {
    if (source) localStorage.setItem(MARKET_KEY + kind, JSON.stringify(source));
    else localStorage.removeItem(MARKET_KEY + kind);
    return true;
  } catch { return false; }
}
function getMarket() {
  const { roster, scoring, penaltyTakers } = modeState();
  const inputs = [dataset, round, roster.join('\0'), marketImports.listone, marketImports.svincolati,
    officialArchive, votesByPlayer, scoring, penaltyTakers.join('\0'), JSON.stringify([...roundAvailability()]), Math.floor(Date.now() / 60000)];
  if (marketCache?.inputs.every((value, index) => value === inputs[index])) {
    return marketCache.result;
  }
  const result = buildMarket({
    listone: marketImports.listone?.rows ?? [],
    freeAgents: marketImports.svincolati?.rows ?? [],
    roster: groupPlayers(roster),
    dataset, round,
    analyze: player => playerAnalysis(player)
  });
  marketCache = { inputs, result };
  return result;
}
function leagueStats() {
  const source = marketImports.listone;
  if (mode !== 'real' || !source) return new Map();
  const rosterLocals = Object.values(modeState().rosterLocals);
  const key = rosterLocals.map(player => player.id).sort().join('\0');
  if (leagueStatsCache?.source !== source || leagueStatsCache.dataset !== dataset || leagueStatsCache.key !== key) {
    const values = indexLeagueStatistics(source.rows, dataset.players, dataset.teams);
    const localStats = indexLeagueStatistics(source.rows, rosterLocals, dataset.teams);
    for (const [id, stats] of localStats) values.set(id, stats);
    leagueStatsCache = { source, dataset, key, values };
  }
  return leagueStatsCache.values;
}
function leagueFantasySamples() {
  const source = marketImports.listone;
  const asOfRound = source?.asOfRound;
  if (mode !== 'real' || !Number.isInteger(asOfRound) || round !== asOfRound + 1) return new Map();
  const stats = leagueStats();
  if (leagueSamplesCache?.stats === stats && leagueSamplesCache.round === round) return leagueSamplesCache.samples;
  const knownGames = new Map();
  for (const fixture of dataset.fixtures) {
    if (fixture.round > asOfRound || fixture.status !== 'played') continue;
    for (const teamId of [fixture.homeId,fixture.awayId]) {
      knownGames.set(teamId, (knownGames.get(teamId) ?? 0) + 1);
    }
  }
  const samples = new Map();
  for (const [id, sample] of stats) {
    const teamGames = knownGames.get(getPlayer(id)?.teamId) ?? 0;
    if (teamGames === asOfRound && Number.isInteger(sample.gamesWithVote) &&
      sample.gamesWithVote <= teamGames && Number.isFinite(sample.fantasyAverage)) {
      samples.set(id, { ...sample, teamGames, asOfRound });
    }
  }
  leagueSamplesCache = { stats, round, samples };
  return samples;
}
function completeRounds() {
  return rounds().filter(day => {
    const fixtures = dataset.fixtures.filter(fixture => fixture.round === day);
    return fixtures.length === dataset.teams.length / 2 && fixtures.every(fixture => fixture.status === 'played');
  });
}
function marketImportCard(kind) {
  const source = marketImports[kind];
  const count = source?.rows.length;
  const outside = source?.rows.filter(row => row.offList).length ?? 0;
  const label = MARKET_UPLOADS[kind];
  return `<section class="panel market-file"><div class="panel-head"><h2>${label}</h2>${source
      ? status(`${number(count)} righe`, 'available')
      : status('Da caricare', 'missing')}</div>
    <p>${source
      ? `Caricato il ${html(date(source.importedAt))} · ${number(outside)} fuori lista${source.skipped ? ` · ${number(source.skipped)} righe saltate` : ''}`
      : kind === 'listone' ? 'Usa l’Excel dei calciatori della lega per consultare ruoli, voti e assegnazioni.' : 'Usa l’Excel degli svincolati della tua lega per trovare i giocatori disponibili.'}</p>
    <div class="file-actions"><label class="btn button-file">${source ? 'Sostituisci' : 'Carica Excel'}<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-market-file="${kind}" aria-label="Carica ${label}"></label>
    ${source ? `<button data-market-clear="${kind}" aria-label="Rimuovi ${label}">Rimuovi</button>` : ''}</div>
    ${source && kind === 'listone' ? `<label class="field-label market-sample-round">Statistiche Excel fino alla giornata<select id="market-as-of-round">
      <option value="">Da confermare per la simulazione</option>${completeRounds().map(day =>
        `<option value="${day}" ${source.asOfRound === day ? 'selected' : ''}>Giornata ${day}</option>`).join('')}</select></label>
      <p>Indica l’ultima giornata compresa nel file. Puoi consultare il Mercato anche senza questo dato.</p>` : ''}</section>`;
}
const MARKET_TABS = { riparazione: 'Riparazione', scambi: 'Scambi', listone: 'Listone della lega' };
const MARKET_AVAILABILITY = {
  free: ['Svincolato','available'], owned: ['Assegnato','partial'], unconfirmed: ['Da verificare','missing'],
  'off-list': ['Fuori lista','missing'], conflict: ['File discordanti','partial']
};
const MARKET_SIGNALS = {
  upgrade: ['Miglioramento','available'], downgrade: ['Peggioramento','partial'], similar: ['Valori simili','missing'],
  limited: ['Campione ridotto','partial'], insufficient: ['Dati insufficienti','missing']
};
function marketClub(profile) { return getTeam(profile.teamId)?.shortName ?? profile.team ?? '—'; }
function marketProfileText(profile) {
  return `${html(profile.name)} · ${html(marketClub(profile))} · ${SHORT[profile.position] ?? '—'}`;
}
function creditInput(value) {
  const n = value === '' ? null : Number(value);
  return Number.isFinite(n) ? n : null;
}
function marketOutgoing(market) {
  return market.roster.find(player => player.key === marketFilters.outgoing
    && (!marketFilters.role || player.position === marketFilters.role));
}
function marketToolbar(market) {
  const outgoing = marketOutgoing(market);
  const catalog = marketFilters.tab === 'listone';
  const repair = marketFilters.tab === 'riparazione';
  const choices = market.roster.filter(p => !marketFilters.role || p.position === marketFilters.role);
  return `<div class="filters market-filters">
    ${catalog ? '' : `<label class="field-label">Giocatore in uscita<select id="market-outgoing">
      <option value="">${repair ? 'Tutta la rosa' : 'Scegli dalla rosa'}</option>
      ${choices.map(p => `<option value="${html(p.key)}" ${outgoing?.key === p.key ? 'selected' : ''}>${marketProfileText(p)}</option>`).join('')}</select></label>`}
    <label class="field-label">Ruolo<select id="market-role"><option value="">Tutti i ruoli</option>${Object.entries(ROLES).map(([id, name]) =>
      `<option value="${id}" ${marketFilters.role === id ? 'selected' : ''}>${name}</option>`).join('')}</select></label>
    <label class="field-label market-query">Cerca<input type="search" id="market-search" placeholder="Nome, club o squadra fantasy" value="${html(marketFilters.search)}"></label>
    ${repair ? `<label class="field-label">Quotazione massima<input type="number" id="market-budget" min="0" max="99999" step="1" placeholder="Qualsiasi" value="${html(marketFilters.budget)}"></label>` : ''}
    ${marketFilters.tab === 'scambi' ? `<label class="field-label">Conguaglio in crediti<input type="number" id="market-credits" min="-99999" max="99999" step="1" placeholder="Facoltativo" value="${html(marketFilters.credits)}"></label>` : ''}
  </div>`;
}
function marketMatch(p) {
  return (!marketFilters.role || p.position === marketFilters.role)
    && (!marketFilters.search || normalized(`${p.name} ${marketClub(p)} ${p.team ?? ''} ${p.owner ?? ''}`).includes(normalized(marketFilters.search)));
}
function marketDelta(value, digits = 0) {
  return Number.isFinite(value) && value > 0 ? `+${number(value,digits)}` : number(value,digits);
}
function marketCard(result, trade = false) {
  if (!result) return '';
  if (!result.ok) return `<p class="notice neutral">${html(result.reason ?? 'Confronto non disponibile.')}</p>`;
  const { outgoing, incoming, delta, signal } = result;
  const [label, tone] = MARKET_SIGNALS[signal] ?? MARKET_SIGNALS.insufficient;
  const credit = result.creditDifference;
  const projection = result.projectionComparison;
  const voteSample = sample => sample ? ` · ${number(sample.votes)}/${number(sample.observations)} a voto` : '';
  return `<article class="market-comparison">
    <div class="panel-head"><h3><span class="muted">${html(outgoing.name)}</span> <span aria-label="in cambio di">→</span> ${html(incoming.name)}</h3>${status(label, tone)}</div>
    <div class="market-facts"><span>Indice ${marketDelta(delta.score)} pt</span><span>FM corretta ${marketDelta(delta.adjustedFantasy,2)}</span><span>Partite a voto ${marketDelta(delta.appearances)}</span>${projection ? `<span>Fantapunti attesi G${number(projection.round)} ${marketDelta(delta.expectedPoints,2)}</span>` : ''}</div>
    <p>${html(ROLES[incoming.position] ?? 'Ruolo mancante')} · ${html(marketClub(incoming))} · FM ${number(incoming.fantasyAverage,2)} su ${number(incoming.appearances)} voti · quotazione ${number(incoming.price)}</p>
    ${trade && Number.isFinite(credit) ? `<p>Conguaglio indicato · ${credit === 0 ? 'nessuno' : `${number(Math.abs(credit))} crediti ${credit > 0 ? 'a tuo carico' : 'in entrata'}`}</p>` : ''}
    <details><summary>Come si confrontano</summary><div class="table-wrap"><table>
      <thead><tr><th>Indicatore</th><th class="numeric">In uscita</th><th class="numeric">In entrata</th></tr></thead>
      <tbody>
        ${[['Indice',outgoing.score,incoming.score,0],['Media voto',outgoing.averageRating,incoming.averageRating,2],
          ['FM su partite a voto',outgoing.fantasyAverage,incoming.fantasyAverage,2],
          ['FM corretta per campione',outgoing.adjustedFantasy,incoming.adjustedFantasy,2],
          ['Partite a voto',outgoing.appearances,incoming.appearances,0],['Quotazione',outgoing.price,incoming.price,0],
          ['Costo storico',outgoing.cost,incoming.cost,0]]
          .map(([name,before,after,digits]) => `<tr><th scope="row">${name}</th><td class="numeric">${number(before,digits)}</td><td class="numeric">${number(after,digits)}</td></tr>`).join('')}
        ${projection ? `<tr><th scope="row">Fantapunti attesi G${number(projection.round)}<br><small>${html(projectionLabel(projection.method))}</small></th><td class="numeric">${number(outgoing.expectedPoints,2)}${voteSample(projection.outgoingSample)}</td><td class="numeric">${number(incoming.expectedPoints,2)}${voteSample(projection.incomingSample)}</td></tr>` : ''}
      </tbody></table></div>
      ${result.projectionMismatch ? '<p>Le stime della giornata usano basi di punteggio diverse.</p>' : ''}
      <p>${html(result.reason ?? '')}</p>
    </details>
  </article>`;
}
function marketList(profiles, comparisons, trade) {
  const pages = Math.max(1, Math.ceil(profiles.length / PER_PAGE));
  marketFilters.page = Math.max(1, Math.min(pages, marketFilters.page));
  const items = profiles.slice((marketFilters.page - 1) * PER_PAGE, marketFilters.page * PER_PAGE);
  if (!items.length) return empty('Nessun calciatore corrisponde a questi filtri.');
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Risultati di mercato">
    <table><thead><tr><th>Calciatore</th><th>Club</th><th>Ruolo</th><th>Disponibilità</th><th>Squadra fantasy</th>
      <th class="numeric" title="Partite con voto">PGv</th><th class="numeric" title="Fantamedia nell’Excel">FM</th>
      <th class="numeric">FM corretta</th><th class="numeric">Quot.</th><th class="numeric">FVM/1000</th>
      <th class="numeric">Indice</th>${comparisons ? '<th class="numeric">Δ indice</th>' : ''}${trade ? '<th>Scambio</th>' : ''}</tr></thead><tbody>
    ${items.map(p => {
      const [label,tone] = MARKET_AVAILABILITY[p.availability] ?? MARKET_AVAILABILITY.unconfirmed;
      const datasetPlayer = p.datasetId ? getPlayer(p.datasetId) : null;
      return `<tr><td>${datasetPlayer ? `<button class="player-name" data-player="${html(p.datasetId)}">${html(p.name)}</button>` : html(p.name)}</td>
        <td>${html(marketClub(p))}</td><td>${SHORT[p.position] ?? '—'}</td><td>${status(label,tone)}</td><td>${html(p.owner ?? '—')}</td>
        <td class="numeric">${number(p.appearances)}</td><td class="numeric">${number(p.fantasyAverage,2)}</td>
        <td class="numeric">${number(p.adjustedFantasy,2)}</td><td class="numeric">${number(p.price)}</td><td class="numeric">${number(p.fvm)}</td>
        <td class="numeric">${number(p.score)}</td>${comparisons ? `<td class="numeric">${marketDelta(comparisons.get(p.key)?.delta.score)}</td>` : ''}
        ${trade ? `<td><button data-market-incoming="${html(p.key)}" aria-label="Confronta ${html(p.name)}" aria-pressed="${p.key === marketFilters.incoming}">Confronta</button></td>` : ''}</tr>`;
    }).join('')}</tbody></table></div>
    <div class="paging"><button data-market-page="-1" ${marketFilters.page === 1 ? 'disabled' : ''}>← Precedente</button>
    <span aria-live="polite">Pagina ${marketFilters.page} / ${pages} · ${number(profiles.length)} calciatori</span>
    <button data-market-page="1" ${marketFilters.page === pages ? 'disabled' : ''}>Successiva →</button></div>`;
}
function marketResults(market) {
  const tab = marketFilters.tab;
  const outgoing = marketOutgoing(market);
  const budget = creditInput(marketFilters.budget);
  const withinBudget = p => budget == null || Number.isFinite(p.price) && p.price <= budget;
  const sortByScore = (a,b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.name.localeCompare(b.name,'it');
  if (tab === 'listone') {
    if (!marketImports.listone) return empty('Carica il listone completo per consultare i calciatori della lega.');
    const complete = market.catalog.filter(p => p.source === 'listone' && marketMatch(p)).sort((a,b) => a.name.localeCompare(b.name,'it'));
    return marketList(complete, null, false);
  }
  const rosterHint = market.roster.length ? '' : '<p class="inline-status">Importa la tua rosa per vedere possibili sostituzioni. <a class="text-link" href="#rosa">Vai alla rosa →</a></p>';
  if (tab === 'scambi') {
    if (!marketImports.listone) return empty('Carica il listone completo per vedere i calciatori assegnati alle altre squadre fantasy.');
    const ownPlayers = new Set(market.roster.map(p => p.playerKey).filter(Boolean));
    const owners = new Set(market.roster.map(p => p.owner).filter(Boolean));
    const assigned = market.catalog.filter(p => p.availability === 'owned' && !ownPlayers.has(p.key)
      && !(owners.size === 1 && owners.has(p.owner)) && (!outgoing || p.position === outgoing.position) && marketMatch(p))
      .sort(sortByScore);
    const ranked = outgoing ? assigned.map(p => compareMarketTrade(market, outgoing.key, p.key)).filter(result => result.ok) : [];
    const comparisons = outgoing ? new Map(ranked.map(result => [result.incoming.key,result])) : null;
    const suggestions = ranked.filter(result => result.signal === 'upgrade').slice(0,3);
    const comparison = outgoing && marketFilters.incoming
      ? compareMarketTrade(market, outgoing.key, marketFilters.incoming, { creditDifference: creditInput(marketFilters.credits) }) : null;
    return `${rosterHint}${outgoing ? '' : '<p class="inline-status">Seleziona un giocatore in uscita per confrontare uno scambio a parità di ruolo.</p>'}
      ${comparison ? marketCard(comparison,true) : suggestions.length ? `<div class="market-suggestions"><h3>Scambi da valutare</h3>
        ${suggestions.map(result => marketCard(result,true)).join('')}</div>` : ''}
      ${marketList(assigned,comparisons,Boolean(outgoing))}`;
  }
  if (!marketImports.svincolati) return empty('Carica l’elenco degli svincolati per restringere i suggerimenti alla tua lega.');
  const eligible = market.freeAgents.filter(p => withinBudget(p) && marketMatch(p)).sort(sortByScore);
  const rank = key => rankMarketReplacements(market, key, { maxReferencePrice: budget, limit: market.freeAgents.length }).candidates;
  const ranked = outgoing ? rank(outgoing.key).filter(c => marketMatch(c.incoming)) : [];
  const candidates = outgoing ? ranked.map(c => c.incoming) : eligible;
  const comparisons = outgoing ? new Map(ranked.map(c => [c.incoming.key,c])) : null;
  const suggestions = outgoing
    ? ranked.filter(c => c.signal === 'upgrade').slice(0,3)
    : market.roster.filter(p => !marketFilters.role || p.position === marketFilters.role)
      .flatMap(p => rank(p.key).filter(c => c.signal === 'upgrade' && marketMatch(c.incoming)).slice(0,1))
      .sort((a,b) => b.delta.score - a.delta.score)
      .filter((item,index,all) => all.findIndex(other => other.incoming.key === item.incoming.key) === index).slice(0,5);
  const offList = market.roster.filter(p => p.offList && (!marketFilters.role || p.position === marketFilters.role));
  return `${rosterHint}
    ${offList.length ? `<p class="notice neutral"><strong>Fuori lista nella tua rosa</strong> ${offList.map(p => html(p.name)).join(', ')}.</p>` : ''}
    ${suggestions.length ? `<div class="market-suggestions"><h3>Migliori sostituzioni</h3><p class="muted">Ogni proposta è un confronto indipendente a parità di ruolo.</p>
      ${suggestions.map(result => marketCard(result)).join('')}</div>`
      : market.roster.length ? '<p class="inline-status">Nessun miglioramento con evidenza sufficiente per i filtri selezionati.</p>' : ''}
    ${marketList(candidates,comparisons,false)}`;
}
function mercato() {
  return renderMercato({
    mode, heading, getMarket, MARKET_UPLOADS, marketImportCard, number, marketImports, marketNotice, html,
    MARKET_TABS, marketFilters, marketToolbar, marketResults
  });
}
function refreshMarket() {
  const results = $('#market-results');
  if (results) results.innerHTML = marketResults(getMarket());
}
async function importMarketFile(kind, file) {
  if (!Object.hasOwn(MARKET_UPLOADS,kind) || mode !== 'real') return;
  const version = ++marketReadVersion[kind];
  try {
    if (file.size > 12 * 1024 * 1024) throw new Error('Il file supera 12 MB.');
    const parsed = await readMarketWorkbook(await file.arrayBuffer());
    if (version !== marketReadVersion[kind]) return;
    const sheet = normalized(parsed.sheet);
    if ((kind === 'listone' && sheet === 'svincolati') || (kind === 'svincolati' && sheet === 'lista calciatori')) {
      throw new Error('Questo Excel appartiene all’altro campo di caricamento.');
    }
    const saved = saveMarketSource(kind, { version: 1, ...parsed, importedAt: new Date().toISOString() });
    marketFilters.page = 1;
    marketFilters.incoming = '';
    marketNotice = `${MARKET_UPLOADS[kind]} · ${number(parsed.rows.length)} righe caricate.${saved ? '' : ' Il salvataggio locale non è disponibile.'}`;
  } catch (error) {
    if (version !== marketReadVersion[kind]) return;
    marketNotice = `${MARKET_UPLOADS[kind]} · ${error.message}`;
  }
  if (page === 'mercato' && mode === 'real') render();
}


async function loadHistoricalArchive() {
  if (historicalRequest) return historicalRequest;
  if (historicalArchive || historicalError) return;
  historicalRequest = (async () => {
    try {
      const inline = document.getElementById('data-history');
      const raw = inline ? JSON.parse(inline.textContent) : await fetch('./data/serie-a-2025-26.json')
        .then(response => {
          if (!response.ok) throw new Error('Archivio storico non raggiungibile.');
          return response.json();
        });
      if (raw.schemaVersion !== 1 || raw.mode !== 'real' || raw.season !== '2025/26' ||
          !Array.isArray(raw.teams) || !Array.isArray(raw.fixtures) || !Array.isArray(raw.players)) throw new Error('Archivio storico non valido.');
      historicalArchive = { ...raw, teamMap: new Map(raw.teams.map(team => [team.id,team])) };
    } catch {
      historicalError = true;
    }
    if (['analisi','match'].includes(page) && mode === 'real') render();
  })();
  await historicalRequest;
  historicalRequest = undefined;
}
function teamSeasonRows(teamId, fixtures, history = false) {
  const matches = fixtures.filter(row => (history || row.status === 'played')
    && (row.homeId === teamId || row.awayId === teamId) && Number.isFinite(row.homeGoals) && Number.isFinite(row.awayGoals));
  const totals = { games: 0, scored: 0, conceded: 0, points: 0, clean: 0 };
  const home = { ...totals };
  const away = { ...totals };
  for (const fixture of matches) {
    const side = fixture.homeId === teamId ? home : away;
    const [scored,conceded] = side === home ? [fixture.homeGoals,fixture.awayGoals] : [fixture.awayGoals,fixture.homeGoals];
    for (const stats of [totals,side]) {
      stats.games++;
      stats.scored += scored;
      stats.conceded += conceded;
      stats.points += scored > conceded ? 3 : scored === conceded ? 1 : 0;
      stats.clean += Number(conceded === 0);
    }
  }
  return {totals,home,away};
}
function byGame(total, games) { return Number.isFinite(total) && games > 0 ? total / games : null; }
function seasonTable(now, then) {
  const splits = [['Totale','totals'],['In casa','home'],['In trasferta','away']];
  const values = stats => [stats.games,byGame(stats.scored,stats.games),byGame(stats.conceded,stats.games),
    byGame(stats.points,stats.games),byGame(stats.clean,stats.games)];
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="Confronto dei risultati per stagione"><table>
    <thead><tr><th>Campione</th><th>Stagione</th><th class="numeric">Partite</th><th class="numeric">Gol fatti/partita</th>
      <th class="numeric">Gol subiti/partita</th><th class="numeric">Punti/partita</th><th class="numeric">Porte inviolate</th></tr></thead>
    <tbody>${splits.map(([label,key]) => [[now,'2026/27'],[then,'2025/26']].map(([sample,season]) => {
      const stats = sample?.[key];
      const cells = stats ? values(stats) : [];
      return `<tr><th scope="row">${label}</th><td>${season}</td>
        ${[0,1,2,3,4].map(index => `<td class="numeric">${index === 4 ? percent(cells[index]) : number(cells[index],index ? 2 : 0)}</td>`).join('')}</tr>`;
    }).join('')).join('')}</tbody></table></div>`;
}
function matchValidation() {
  if (historicalArchive && matchBacktest?.dataset !== dataset) {
    matchBacktest = { dataset, report: backtestMatches(dataset.fixtures, historicalArchive.fixtures) };
  }
  return matchBacktest?.report;
}
function analisi() {
  return renderAnalisi({
    mode, heading, dataset, historicalArchive, analysisTeamId, empty, getTeam, teamSeasonRows,
    matchValidation, metric, number, html, historicalError, seasonTable, sourceLink, byGame,
    officialVotesPanel, votesPanel
  });
}

function refreshPlayers() {
  const list = $('#player-list');
  if (list) list.innerHTML = playerList();
  const compare = $('#comparison');
  if (compare) compare.innerHTML = comparison();
}
function setPage(next) {
  if (page === next) { render(); return; }
  page = next;
  render();
  if (['analisi','match','simulazione'].includes(next) && mode === 'real') void loadHistoricalArchive();
  window.scrollTo(0,0);
  $('#workspace').focus({ preventScroll: true });
}
function wireEvents() {
  pageView.addEventListener('dragover', event => {
    const drop = event.target.closest('#official-votes-drop');
    if (!drop || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    drop.classList.add('is-over');
  });
  pageView.addEventListener('dragleave', event => event.target.closest('#official-votes-drop')?.classList.remove('is-over'));
  pageView.addEventListener('drop', event => {
    if (!event.target.closest('#official-votes-drop')) return;
    event.preventDefault();
    event.target.closest('#official-votes-drop').classList.remove('is-over');
    if (mode === 'real') void importOfficialFiles([...event.dataTransfer.files]);
  });
  wireLineupDrag(pageView, {
    getFeedback(id, target) {
      return page === 'rosa' && Boolean(placeLineupPlayer(lineup(), lineupRoster(), id, target).starters);
    },
    onDrop(id, target) {
      if (page === 'rosa') applyLineupPlacement(id, target);
    }
  });
  pageView.addEventListener('keydown', event => {
    if (event.key === 'Escape' && lineupSelection) setLineupSelection(lineupSelection);
  });
  for (const element of document.querySelectorAll('[data-icon]')) element.innerHTML = icon(element.dataset.icon);
  window.addEventListener('hashchange', () => {
    const hash = location.hash.slice(1);
    if (Object.hasOwn(PAGES, hash) || !hash) setPage(currentPage());
  });
  window.addEventListener('storage', event => {
    if (event.key === KEY) {
      const next = readStorage();
      const changedModes = ['real', 'demo'].filter(kind => JSON.stringify(storage[kind]) !== JSON.stringify(next[kind]));
      storage = next;
      for (const kind of changedModes) lineupUndo[kind].clear();
      if (changedModes.includes(mode)) {
        lineupCopyPreview = false;
        invalidateLineupResults();
        if (dataset) renderLineupChange();
      }
      return;
    }
    if (event.key === VOTES_KEY) {
      votesImport = readVotesImport();
      votesByPlayer = indexVotes(votesImport);
      votesReport = undefined;
      invalidateLineupResults();
      if (dataset && mode === 'real') render();
      return;
    }
    const kind = event.key?.startsWith(MARKET_KEY) ? event.key.slice(MARKET_KEY.length) : null;
    if (!Object.hasOwn(MARKET_UPLOADS,kind)) return;
    marketImports[kind] = readMarketSource(kind);
    marketCache = undefined;
    if (kind === 'listone') invalidateLineupResults();
    if (dataset && ['mercato','simulazione'].includes(page) && mode === 'real') render();
  });
  dialog.addEventListener('close', () => lastFocus?.isConnected && lastFocus.focus());
  document.addEventListener('click', event => {
    if (event.target.closest('[data-show-difficulty]')) showDifficulty = true;
    if (page === 'rosa' && dataset && pageView.contains(event.target)) {
      const handle = event.target.closest('[data-lineup-drag]');
      const zone = event.target.closest('[data-lineup-drop]');
      if (zone && lineupSelection && !event.target.closest('[data-reserve]') &&
          (zone.dataset.dropPlayer !== lineupSelection || !handle)) {
        const id = lineupSelection;
        applyLineupPlacement(id, lineupDropTarget(zone));
        if (!lineupSelection && event.detail === 0) {
          const handles = [...pageView.querySelectorAll('[data-lineup-drag]')].filter(button => button.dataset.lineupDrag === id);
          (handles.find(button => !button.closest('.roster-list')) ?? handles[0])?.focus({ preventScroll: true });
        }
        return;
      }
      if (handle) {
        setLineupSelection(handle.dataset.lineupDrag);
        return;
      }
      if (zone && !event.target.closest('[data-reserve]')) {
        notify('Seleziona prima un calciatore dalla rosa, dal campo o dalla panchina.');
        return;
      }
    }
    const control = event.target.closest('button');
    if (!control) return;
    const data = control.dataset;
    if (data.mode) { if (data.mode !== mode || pageView.getAttribute('aria-busy') === 'true') { importReport = undefined; void switchMode(data.mode); } return; }
    if (!dataset) return;
    if (page === 'rosa') {
      if ('lineupSuggest' in data) {
        lineupSuggestion = suggestLineup(groupPlayers(modeState().roster), lineup(), {
          formations:FORMATION_OPTIONS, validate:validateLineup, analyze:playerAnalysis });
        renderLineupChange(() => $('[data-lineup-accept]') ?? $('[data-lineup-suggest]'));
        return;
      }
      if ('lineupAccept' in data && lineupSuggestion?.lineup) {
        changeLineup(lineupSuggestion.lineup, () => $('[data-lineup-undo]'));
        notify('Formazione suggerita applicata.');
        return;
      }
      if ('lineupCopy' in data || 'lineupCopyConfirm' in data) copyPreviousLineup('lineupCopyConfirm' in data);
      if ('lineupCopyCancel' in data) {
        lineupCopyPreview = false;
        renderLineupChange(() => $('[data-lineup-copy]'));
      }
    }
    if (['rosa','simulazione'].includes(page) && 'lineupUndo' in data) undoLineupChange();
    if (page === 'simulazione') {
      if (data.lineupReference) handleLineupReference(data.lineupReference);
      if ('lineupCompare' in data) runLineupComparison();
      if ('saveForecast' in data) saveForecast();
    }
    if ('votesTemplate' in data) {
      download('Stagione;Giornata;ID FantaLab;Nome;Squadra;Ruolo;Fantavoto;Voto\r\n', 'fantalab-fantavoti.csv', 'text/csv;charset=utf-8');
    }
    if (page === 'analisi' && mode === 'real') {
      if (data.officialRemove) void updateOfficialSettings({ remove:data.officialRemove });
      if ('officialRelink' in data) void updateOfficialSettings({ relink:true });
      if ('officialCancel' in data) {
        officialPending = undefined;
        refreshOfficialPanel();
      }
    }
    if ('votesClear' in data) {
      votesImportVersion++;
      const saved = setVotesImport(null);
      votesReport = { message: saved ? 'Fantavoti rimossi.' : 'Fantavoti rimossi dalla sessione. Il browser non ha aggiornato il salvataggio.' };
      render();
    }
    if (data.fixture) {
      if (page === 'match') {
        selectedFixtureId = data.fixture;
        const detail = $('#match-detail');
        detail.innerHTML = matchCard(byRound().find(f => f.id === selectedFixtureId));
        for (const button of document.querySelectorAll('[data-fixture]')) {
          if (button.dataset.fixture === selectedFixtureId) button.setAttribute('aria-current','true');
          else button.removeAttribute('aria-current');
        }
        if (window.matchMedia('(max-width: 590px)').matches) detail.scrollIntoView({ block: 'start' });
      } else {
        goRound(Number(data.fixtureRound));
        selectedFixtureId = data.fixture;
        location.hash = 'match';
      }
    }
    if (data.openMatchRound) {
      goRound(Number(data.openMatchRound));
      location.hash = 'match';
    }
    if (data.round) goRound(Number(data.round));
    if (Object.hasOwn(MARKET_TABS,data.marketTab)) {
      Object.assign(marketFilters, { tab:data.marketTab, search:'', role:'', outgoing:'', incoming:'', page:1 });
      if (page === 'mercato') {
        render();
        $('#view .market-tabs [aria-pressed="true"]')?.focus({preventScroll:true});
      } else location.hash = 'mercato';
    }
    if (Object.hasOwn(MARKET_UPLOADS,data.marketClear)) {
      marketReadVersion[data.marketClear]++;
      const removed = saveMarketSource(data.marketClear, null);
      marketNotice = removed ? 'Elenco rimosso dal browser.' : 'Il browser non ha confermato la rimozione dal salvataggio locale.';
      marketFilters.incoming = '';
      render();
    }
    if (data.marketPage) {
      marketFilters.page += Number(data.marketPage);
      refreshMarket();
      $('#market-results .paging button:not(:disabled)')?.focus({preventScroll:true});
    }
    if (data.marketIncoming) {
      marketFilters.incoming = data.marketIncoming;
      refreshMarket();
      $('#market-results .market-comparison')?.scrollIntoView({block:'nearest'});
    }
    if (data.club) { filters.team = data.club; filters.search = ''; filters.position = ''; filters.page = 1; location.hash = 'giocatori'; }
    if (data.player) showPlayer(data.player);
    if (data.simulatePlayer) {
      const player = getPlayer(data.simulatePlayer);
      if (player) $('#individual-simulation').innerHTML = simulatorOutput(simulateLineup([player], {
        dataset, mode, round, iterations: 5000, seed: 202627, maxSubstitutions: 0,
        fantasySamples: mode === 'real' ? leagueFantasySamples() : undefined,
        leagueVotesByPlayer: mode === 'real' ? votesByPlayer : undefined, ...scoringOptions()
      }), true);
    }
    if (data.add) {
      addPlayer(data.add);
      if (dialog.open) { showPlayer(data.add); $('.dialog-close').focus(); }
      if (page === 'giocatori') refreshPlayers();
      if (page === 'rosa') render();
    }
    if (data.remove) removePlayer(data.remove);
    if (data.reserve) moveReserve(data.reserve, Number(data.move));
    if (data.pageChange) { filters.page += Number(data.pageChange); refreshPlayers(); $('#player-list').querySelector('button')?.focus({ preventScroll: true }); }
    if ('clearComparison' in data) { selectedComparison[mode] = []; refreshPlayers(); $('#player-search').focus(); }
    if ('loadPreset' in data) preset();
    if ('closeDialog' in data) dialog.close();
    if ('export' in data) {
      if (mode === 'real' && (!officialLoaded || officialBusy)) {
        notify('Attendi il caricamento dell’archivio voti prima di esportare.');
        return;
      }
      const backup = { schemaVersion:1, season:'2026/27', state:storage };
      if (officialArchive.days.length) backup.officialVotes = { edition:officialArchive.edition, days:officialArchive.days };
      download(JSON.stringify(backup), 'fantalab-pro-backup-personale.json','application/json');
    }
    if ('csvTemplate' in data) download('\uFEFFid;nome;squadra\r\n','fantalab-pro-rosa.csv','text/csv;charset=utf-8');
  });
  document.addEventListener('input', event => {
    if (event.target.id === 'player-search') { filters.search = event.target.value; filters.page = 1; refreshPlayers(); }
    if (event.target.id === 'market-search') {
      marketFilters.search = event.target.value;
      marketFilters.page = 1;
      refreshMarket();
    }
  });
  document.addEventListener('change', async event => {
    if (!dataset) return;
    const { id, value } = event.target;
    if (mode === 'real' && id === 'official-votes-files') {
      await importOfficialFiles([...event.target.files]);
      return;
    }
    if (mode === 'real' && id === 'official-votes-edition') {
      await updateOfficialSettings({ edition:value });
      return;
    }
    if (event.target.dataset.penaltyTaker) {
      const playerId = event.target.dataset.penaltyTaker;
      const takers = new Set(modeState().penaltyTakers);
      if (event.target.checked) takers.add(playerId);
      else takers.delete(playerId);
      modeState().penaltyTakers = [...takers];
      invalidateLineupResults();
      save();
      if (page === 'rosa') renderLineupChange();
      if (page === 'simulazione') render();
      return;
    }
    if (id === 'votes-csv') {
      const file = event.target.files?.[0];
      if (file && mode === 'real') await importVotesFile(file, $('#votes-source').value.trim());
      return;
    }
    if (id === 'analysis-team' && (getTeam(value) || historicalArchive?.teamMap.has(value))) {
      analysisTeamId = value;
      render();
      $('#analysis-team')?.focus({preventScroll:true});
    }
    if (event.target.dataset.marketFile) {
      const file = event.target.files?.[0];
      if (file) await importMarketFile(event.target.dataset.marketFile, file);
      return;
    }
    const marketFilter = {'market-role':'role','market-outgoing':'outgoing','market-budget':'budget','market-credits':'credits'}[id];
    if (id === 'market-as-of-round' && marketImports.listone) {
      const day = Number(value);
      const asOfRound = completeRounds().includes(day) ? day : undefined;
      const saved = saveMarketSource('listone', { ...marketImports.listone, asOfRound });
      invalidateLineupResults();
      render();
      $('#market-as-of-round')?.focus({preventScroll:true});
      if (!saved) notify('Il browser non ha salvato la giornata del listone.');
      return;
    }
    if (marketFilter) {
      marketFilters[marketFilter] = value;
      if (marketFilter !== 'credits') marketFilters.page = 1;
      if (marketFilter === 'role' || marketFilter === 'outgoing') marketFilters.incoming = '';
      if (marketFilter === 'role') {
        if (!marketOutgoing(getMarket())) marketFilters.outgoing = '';
        render();
        $('#market-role')?.focus({preventScroll:true});
      } else refreshMarket();
    }
    if (id === 'round') goRound(Number(value));
    const filter = { 'player-position': 'position', 'player-team': 'team', 'player-sort': 'sort' }[id];
    if (filter) { filters[filter] = value; filters.page = 1; refreshPlayers(); }
    const compare = event.target.dataset.compare;
    if (compare) {
      if (event.target.checked && selectedComparison[mode].length >= 3) {
        event.target.checked = false;
        notify('Deseleziona un calciatore prima di confrontarne un altro.');
      } else {
        selectedComparison[mode] = event.target.checked ? [...selectedComparison[mode], compare] : selectedComparison[mode].filter(value => value !== compare);
        $('#comparison').innerHTML = comparison();
      }
    }
    if (event.target.dataset.lineupRole) setLineupRole(event.target.dataset.lineupRole, value);
    if (id === 'formation' && FORMATION_OPTIONS.includes(value)) {
      changeLineup({ ...lineup(), formation: value }, () => $('#formation'));
    }
    if (id === 'substitutions') {
      changeLineup({ ...lineup(), maxSubstitutions: Number(value) }, () => $('#substitutions'));
    }
    if (id === 'roster-csv' || id === 'backup-json') {
      const file = event.target.files?.[0];
      if (!file) return;
      const activeMode = mode;
      try {
        const maxBytes = id === 'backup-json' ? 32_000_000 : 2_000_000;
        if (file.size > maxBytes) throw new Error(`Il file supera ${maxBytes / 1_000_000} MB.`);
        const text = id === 'roster-csv' ? decodeRosterCsv(await file.arrayBuffer()) : await file.text();
        if (activeMode !== mode) return;
        importReport = id === 'roster-csv' ? importCsv(text) : { message: await restoreBackup(text) };
      } catch (error) { importReport = { message: error instanceof SyntaxError ? 'Backup JSON non valido.' : error.message }; }
      render();
    }
  });
  document.addEventListener('submit', event => {
    if (event.target.id === 'official-votes-confirm') {
      event.preventDefault();
      const season = new FormData(event.target).get('season');
      if (mode === 'real' && officialPending && ['2026/27','2025/26'].includes(season)) void importOfficialFiles(officialPending, season);
      return;
    }
    if (event.target.id === 'classic-scoring') {
      event.preventDefault();
      const data = new FormData(event.target);
      const settings = Object.fromEntries(Object.keys(SCORING_LABELS).map(key => [key, Number(data.get(key))]));
      modeState().scoring = sanitizeScoring({ ...settings,
        defenseModifier: data.has('defenseModifier'), defenseIncludesKeeper: data.has('defenseIncludesKeeper') });
      invalidateLineupResults();
      save();
      render();
      $('#classic-scoring').closest('details').open = true;
      $('#classic-scoring button').focus({ preventScroll: true });
      notify('Regolamento salvato.');
      return;
    }
    if (event.target.id === 'manual-availability') {
      event.preventDefault();
      const { playerId, round: day } = event.target.dataset;
      if (!getPlayer(playerId) || Number(day) !== round) return;
      const data = new FormData(event.target);
      const record = manualAvailabilityRecord({ status: data.get('status'), reason: data.get('reason'), diffidato: data.has('diffidato') });
      const state = modeState();
      const reports = state.availability[round] ??= {};
      if (record) Object.defineProperty(reports, playerId, { value: record, enumerable: true, writable: true, configurable: true });
      else delete reports[playerId];
      if (!Object.keys(reports).length) delete state.availability[round];
      invalidateLineupResults();
      save();
      if (page === 'rosa') renderLineupChange();
      if (page === 'giocatori') refreshPlayers();
      if (page === 'simulazione') render();
      showPlayer(playerId);
      $('#manual-availability button[type="submit"]')?.focus({ preventScroll: true });
      notify(record ? 'Segnalazione salvata per questa giornata.' : 'Segnalazione manuale rimossa.');
      return;
    }
    if (event.target.id === 'roster-add') {
      event.preventDefault();
      addPlayer($('#roster-choice').value);
      render();
      $('#roster-choice')?.focus();
    }
    if (event.target.id === 'simulation-form') {
      event.preventDefault();
      simulationResult = simulationFor(event.target)(lineup());
      $('#simulation-output').innerHTML = lineupSimulationOutput();
    }
  });
}
wireEvents();
void switchMode('real');
void openOfficialArchive();
if (document.querySelector('meta[name="fantalab-offline"]')?.content === 'enabled' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
