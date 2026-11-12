import { analyzePlayer, simulateLineup, FORMATION_OPTIONS, validateLineup, getPlayerFixture } from './model.js';
import { decodeRosterCsv, makeRosterCsvId, readRosterCsv } from './roster-import.js';
import { readMarketWorkbook } from './market-import.js';
import { buildMarket, rankMarketReplacements, compareMarketTrade } from './market.js';

const PAGES = {
  panoramica: 'Panoramica', match: 'Match Center', giocatori: 'Calciatori',
  rosa: 'La mia rosa', mercato: 'Mercato', simulazione: 'Simulazione', fonti: 'Fonti e metodo'
};
const ROLES = { GK: 'Portiere', DEF: 'Difensore', MID: 'Centrocampista', FWD: 'Attaccante' };
const SHORT = { GK: 'P', DEF: 'D', MID: 'C', FWD: 'A' };
const COVERAGE = {
  fixtures: 'Calendario', results: 'Risultati', players: 'Listone calciatori',
  playerStats: 'Statistiche individuali', ratings: 'Voti storici FantaTB', expectedGoals: 'xG individuali',
  expectedAssists: 'xA individuali', absences: 'Indisponibilità'
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
const calendarDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' });
const KEY = 'fantalab-pro/2026-27/v1';
const MARKET_KEY = 'fantalab-pro/2026-27/mercato/v1/';
const MARKET_UPLOADS = { listone: 'Listone completo', svincolati: 'Svincolati della lega' };
const PER_PAGE = 24;
const $ = (selector) => document.querySelector(selector);
const pageView = $('#view');
const dialog = $('#player-dialog');
const cache = new Map();
const filters = { search: '', position: '', team: '', sort: 'name', page: 1 };
const marketFilters = { tab: 'riparazione', search: '', role: '', outgoing: '', incoming: '', budget: '', credits: '', page: 1 };
const selectedComparison = { real: [], demo: [] };
const views = { panoramica, match, giocatori, rosa, mercato, simulazione, fonti };
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
let marketNotice = '';
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
    if (m === 'real') {
      clean[m].rosterLocals = {};
      for (const id of clean[m].roster) {
        const player = saved.rosterLocals?.[id];
        if (!player || makeRosterCsvId(player.name, player.teamId, player.position) !== id) continue;
        const { name, teamId, position } = player;
        clean[m].rosterLocals[id] = { id, name, teamId, position };
      }
    }
    clean[m].round = Number.isInteger(saved.round) && saved.round >= 1 && saved.round <= 38 ? saved.round : undefined;
    clean[m].lineups = {};
    for (const [key, value] of Object.entries(saved.lineups ?? {})) {
      if (!/^(?:[1-9]|[12]\d|3[0-8])$/.test(key) || !value || typeof value !== 'object') continue;
      const starters = ids(value.starters).slice(0, 11);
      clean[m].lineups[key] = {
        formation: FORMATION_OPTIONS.includes(value.formation) ? value.formation : '3-4-3',
        starters,
        reserves: ids(value.reserves).filter(id => !starters.includes(id)),
        maxSubstitutions: Number.isInteger(value.maxSubstitutions) ? Math.max(0, Math.min(5, value.maxSubstitutions)) : 3
      };
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
  return saved;
}
function lineup() {
  const state = modeState();
  state.lineups[round] ??= { formation: '3-4-3', starters: [], reserves: [], maxSubstitutions: 3 };
  return state.lineups[round];
}
function currentPage() {
  const name = location.hash.slice(1);
  return Object.hasOwn(PAGES, name) ? name : 'panoramica';
}
function today() {
  const parts = Object.fromEntries(calendarDay.formatToParts(new Date()).map(({type, value}) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function fixtureDay(fixture) { return fixture.date ?? fixture.kickoff?.slice(0, 10) ?? null; }
function rounds() {
  return [...new Set(dataset.fixtures.map(fixture => fixture.round))].sort((a, b) => a - b);
}
function defaultRound(data) {
  const allRounds = [...new Set(data.fixtures.map(fixture => fixture.round))].sort((a, b) => a - b);
  if (data.mode === 'demo') return data.demoPreset?.round ?? allRounds.find(r => data.fixtures.some(f => f.round === r && f.status === 'scheduled')) ?? 1;
  const upcoming = data.fixtures.filter(f => fixtureDay(f) >= today() && f.status !== 'played');
  return upcoming.sort((a, b) => fixtureDay(a).localeCompare(fixtureDay(b)))[0]?.round ?? allRounds.at(-1) ?? 1;
}
function byRound() {
  return dataset.fixtures.filter(f => f.round === round).sort((a, b) =>
    (a.kickoff ?? fixtureDay(a) ?? '9999').localeCompare(b.kickoff ?? fixtureDay(b) ?? '9999')
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
  $('#mode-notice').innerHTML = mode === 'demo'
    ? '<div class="notice"><strong>Modalità demo</strong> Squadre, calciatori, risultati e statistiche sono inventati. Le tue formazioni demo sono salvate a parte.</div>'
    : '';
}
async function loadDataset(nextMode) {
  if (cache.has(nextMode)) return cache.get(nextMode);
  const embedded = document.getElementById(`data-${nextMode}`);
  const path = nextMode === 'real' ? './data/serie-a-2026-27.json' : './data/demo.json';
  let raw;
  if (embedded) raw = JSON.parse(embedded.textContent);
  else {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) throw new Error('Dati non raggiungibili.');
    raw = await response.json();
  }
  if (raw.mode !== nextMode || raw.season !== '2026/27' || raw.schemaVersion !== 1) throw new Error('Formato dati incompatibile.');
  for (const key of ['teams', 'fixtures', 'players', 'sources', 'absences']) {
    if (!Array.isArray(raw[key])) throw new Error('Dataset incompleto.');
  }
  if (!raw.coverage || typeof raw.coverage !== 'object') throw new Error('Copertura sconosciuta.');
  const loaded = {
    ...raw,
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
    round = rounds().includes(modeState().round) ? modeState().round : defaultRound(dataset);
    selectedFixtureId = undefined;
    simulationResult = undefined;
    Object.assign(filters, { search: '', position: '', team: '', sort: 'name', page: 1 });
    setModeNotice();
    render();
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
}
function goRound(next) {
  if (!rounds().includes(next) || next === round) return;
  round = next;
  modeState().round = round;
  selectedFixtureId = undefined;
  simulationResult = undefined;
  save();
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
  if (fixture.status === 'played') return `Finale · ${date(fixtureDay(fixture))}`;
  const day = fixtureDay(fixture);
  const historic = day && day < today();
  if (fixture.status === 'postponed') return 'Rinviata';
  if (fixture.status === 'cancelled') return 'Annullata';
  if (fixture.status === 'live') return 'In corso';
  if (fixture.status === 'unknown' || historic && !Number.isFinite(fixture.homeGoals)) return 'Risultato mancante';
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
  return `<ul class="fixture-list">${fixtures.map(f => `<li><button class="fixture-row" type="button" data-fixture="${html(f.id)}"${f.id === current ? ' aria-current="true"' : ''}>
    <span class="fixture-main">${teamPill(f.homeId)}<span class="score">${score(f)}</span>${teamPill(f.awayId, true)}</span>
    <span class="fixture-detail">${html(matchTime(f))}</span>
  </button></li>`).join('')}</ul>`;
}
function panoramica() {
  const fixtures = byRound();
  const finalCount = dataset.fixtures.filter(f => f.status === 'played').length;
  const ready = dataset.players.filter(p => Number.isFinite(p.minutes) && Number.isFinite(p.appearances)).length;
  const rosterCount = groupPlayers(modeState().roster).length;
  return `<section class="hero" aria-labelledby="overview-title">
    <div class="hero-image" aria-hidden="true"></div><div class="eyebrow">Serie A 2026/27 · Giornata ${round}</div>
    <h1 id="overview-title">FantaLab Pro</h1>
    <p>Analizza gli incroci della giornata, consulta le statistiche e prepara la tua formazione.</p>
    <div class="hero-actions"><a class="btn primary" href="#match">Apri Match Center ${iconSpan('arrow')}</a><a class="btn" href="#rosa">Vai alla rosa</a></div>
  </section>
  <section class="metrics" aria-label="Stato della stagione">
    ${metric('Risultati acquisiti', `${number(finalCount)}<small> / ${number(dataset.fixtures.length)}</small>`, 'Partite con risultato finale', 'pitch')}
    ${metric('Calciatori nel listone', number(dataset.players.length), `${number(ready)} con minuti e presenze`, 'users')}
    ${metric('La tua rosa', number(rosterCount), 'Calciatori salvati in questa modalità', 'shirt')}
  </section>
  <div class="split">
    <section class="panel"><div class="panel-head"><div><h2>Partite della giornata</h2><p>Giornata ${round} · ${fixtures.length} incontri</p></div><a class="text-link" href="#match">Tutti gli incontri →</a></div>${fixtureList(fixtures.slice(0, 5))}</section>
    <section class="panel"><div class="panel-head"><h2>Copertura dati</h2><a class="text-link" href="#fonti">Vedi fonti →</a></div>${coverageRows(['fixtures','results','players','ratings','expectedGoals','expectedAssists','absences'])}</section>
  </div>`;
}
function previousForm(teamId, fixture) {
  const cutoff = fixtureDay(fixture);
  if (!cutoff) return null;
  const games = dataset.fixtures.filter(f => f.status === 'played' && fixtureDay(f) && fixtureDay(f) < cutoff &&
    (f.homeId === teamId || f.awayId === teamId) && Number.isFinite(f.homeGoals) && Number.isFinite(f.awayGoals))
    .sort((a, b) => fixtureDay(b).localeCompare(fixtureDay(a))).slice(0, 5);
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
function threeWay(home, away) {
  if (!home || !away) return null;
  const rate = (attack, defense, factor) => Math.min(4, Math.max(0.1, (attack + defense) * factor / 2));
  const homeRate = rate(home.xg ?? home.gf, away.xga ?? away.ga, 1.09);
  const awayRate = rate(away.xg ?? away.gf, home.xga ?? home.ga, 0.95);
  const poisson = lambda => {
    const p = [Math.exp(-lambda)];
    for (let k = 1; k <= 15; k++) p.push(p[k - 1] * lambda / k);
    return p;
  };
  const homeGoals = poisson(homeRate);
  const awayGoals = poisson(awayRate);
  const odds = [0, 0, 0];
  homeGoals.forEach((p, h) => awayGoals.forEach((q, a) => { odds[h > a ? 0 : h === a ? 1 : 2] += p * q; }));
  const total = odds.reduce((sum, value) => sum + value, 0);
  return odds.map(value => value / total);
}
function formSummary(form) {
  return form ? `${form.n} partite acquisite · G${form.oldestRound}–G${form.newestRound} · ${number(form.gf, 2)} gol fatti / ${number(form.ga, 2)} subiti a partita` : 'Meno di tre risultati precedenti acquisiti';
}
function matchCard(fixture) {
  if (!fixture) return empty('Seleziona un incontro.');
  const home = previousForm(fixture.homeId, fixture);
  const away = previousForm(fixture.awayId, fixture);
  const scheduled = fixture.status === 'scheduled' && (mode === 'demo' || !fixtureDay(fixture) || fixtureDay(fixture) >= today());
  const odds = scheduled ? threeWay(home, away) : null;
  const rows = [['Difesa e portiere','defense','Produzione offensiva avversaria'],['Centrocampo','midfield','Equilibrio tra gol fatti e concessi dall’avversario'],['Attacco','attack','Gol concessi dall’avversario']];
  const absences = dataset.absences.filter(a => a.fixtureId === fixture.id);
  const statusLabels = { out: 'Indisponibile', doubtful: 'In dubbio', available: 'Disponibile', reported: 'Segnalata', unknown: 'Stato mancante' };
  return `<div class="detail-header"><h2>${html(getTeam(fixture.homeId)?.shortName)} – ${html(getTeam(fixture.awayId)?.shortName)}</h2>${status(score(fixture), fixture.status === 'played' ? 'available' : 'missing')}</div>
    <p>${html(matchTime(fixture))}</p>
    <div class="duel"><h3>Andamento prima della partita</h3><p>Casa · ${formSummary(home)}</p><p>Trasferta · ${formSummary(away)}</p>
      <p>xG / xGA a partita · casa ${number(home?.xg, 2)} / ${number(home?.xga, 2)} · trasferta ${number(away?.xg, 2)} / ${number(away?.xga, 2)}</p></div>
    <div class="duel"><h3>Difficoltà per reparto</h3><p>Stima dai risultati precedenti acquisiti, fino a cinque partite per squadra. Il centrocampo usa una media dei due indicatori di squadra.</p></div>
    ${rows.map(([label, role, hint]) => `<div class="duel"><div class="duel-row"><span>${status(opponentLevel(away, role), away ? 'partial' : 'missing')}</span><strong>${label}</strong><span>${status(opponentLevel(home, role), home ? 'partial' : 'missing')}</span></div><p>${hint}</p></div>`).join('')}
    ${odds ? `<div class="duel"><h3>Stima 1X2</h3><div class="probability" aria-hidden="true">${odds.map(value => `<span style="width:${value * 100}%"></span>`).join('')}</div>
      <div class="legend"><span>Casa ${percent(odds[0])}</span><span>Pareggio ${percent(odds[1])}</span><span>Trasferta ${percent(odds[2])}</span></div><p>Modello Poisson semplice, con vantaggio casa fisso e senza calibrazione storica.</p></div>` : ''}
    <div class="duel"><h3>Indisponibilità segnalate</h3>${absences.length ? `<ul>${absences.map(a => `<li>${html(getPlayer(a.playerId)?.name ?? a.playerId)} · ${html(statusLabels[a.status] ?? 'Stato mancante')}${a.reason ? ` · ${html(a.reason)}` : ''}</li>`).join('')}</ul>`
      : '<p>Nessuna segnalazione acquisita per questo incontro. La disponibilità dei singoli resta sconosciuta.</p>'}</div>
    <div class="duel"><h3>Analisi individuale</h3><p>Apri il listone di una squadra per vedere statistiche, disponibilità e indice per questa giornata.</p>
      <div class="actions"><button data-club="${html(fixture.homeId)}">${html(getTeam(fixture.homeId)?.shortName ?? 'Casa')}</button><button data-club="${html(fixture.awayId)}">${html(getTeam(fixture.awayId)?.shortName ?? 'Trasferta')}</button></div></div>`;
}
function match() {
  const fixtures = byRound();
  const current = fixtures.find(f => f.id === selectedFixtureId) ?? fixtures[0];
  const allRounds = rounds();
  const index = allRounds.indexOf(round);
  return `${heading('Match Center', 'Calendario, risultati, rendimento recente e difficoltà per reparto.')}
    <div class="split">
      <section class="panel"><div class="panel-head"><div><h2>Giornata ${round}</h2><p>Orari italiani quando disponibili</p></div><div class="actions"><button data-round="${allRounds[index - 1] ?? ''}" aria-label="Giornata precedente" ${index <= 0 ? 'disabled' : ''}>←</button>
        <button data-round="${allRounds[index + 1] ?? ''}" aria-label="Giornata successiva" ${index === allRounds.length - 1 ? 'disabled' : ''}>→</button></div></div>${fixtureList(fixtures, current?.id)}</section>
      <section class="panel" id="match-detail" aria-label="Dettaglio incontro">${matchCard(current)}</section>
    </div>`;
}
function playerAnalysis(player) {
  return analyzePlayer(player, { dataset, fixture: getPlayerFixture(player, dataset.fixtures, round), round, mode });
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
  if (candidates.length === 1) return `<section class="panel stacked"><h2>Confronto</h2><p>Hai selezionato ${html(candidates[0].name)}. Seleziona un secondo calciatore.</p></section>`;
  const metrics = {
    'Presenze': p => number(p.appearances), 'Minuti': p => number(p.minutes), 'Gol': p => number(p.goals),
    'Assist': p => number(p.assists), 'xG/90': p => number(per90(p.xg, p.minutes), 2),
    'xA/90': p => number(per90(p.xa, p.minutes), 2), 'Indice': p => number(playerAnalysis(p).index),
    'Fantapunti attesi': p => number(playerAnalysis(p).expectedPoints, 2)
  };
  return `<section class="panel stacked"><div class="panel-head"><h2>Confronto</h2><button data-clear-comparison>Deseleziona tutti</button></div>
    <div class="table-wrap"><table><thead><tr><th>Statistica</th>${candidates.map(p => `<th class="numeric">${html(p.name)}</th>`).join('')}</tr></thead><tbody>
    ${Object.entries(metrics).map(([label, value]) => `<tr><th scope="row">${label}</th>${candidates.map(p => `<td class="numeric">${value(p)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
}
function giocatori() {
  const teams = [...dataset.teams].sort((a,b) => a.shortName.localeCompare(b.shortName, 'it'));
  return `${heading('Calciatori', 'Apri una scheda per vedere numeri stagionali, andamento e motivi dell’indice di schierabilità.',
      mode === 'real' ? '<button data-market-tab="listone">Apri listone della lega</button>' : '')}
    <section class="panel">
      <div class="filters">
        <input id="player-search" type="search" aria-label="Cerca calciatore" placeholder="Cerca per nome o squadra" value="${html(filters.search)}">
        <select id="player-position" aria-label="Filtra per ruolo"><option value="">Tutti i ruoli</option>${Object.entries(ROLES).map(([id, name]) => `<option value="${id}" ${id === filters.position ? 'selected' : ''}>${name}</option>`).join('')}</select>
        <select id="player-team" aria-label="Filtra per squadra"><option value="">Tutte le squadre</option>${teams.map(t => `<option value="${html(t.id)}" ${t.id === filters.team ? 'selected' : ''}>${html(t.shortName)}</option>`).join('')}</select>
        <select id="player-sort" aria-label="Ordina calciatori">${[['name','Nome'],['index','Schierabilità'],['xg','xG'],['xa','xA'],['minutes','Minuti'],['goals','Gol']].map(([key, label]) => `<option value="${key}" ${key === filters.sort ? 'selected' : ''}>Ordina per ${label}</option>`).join('')}</select>
      </div>
      <p class="inline-status">Il trattino indica un dato mancante. ${mode === 'real' ? '<a class="text-link" href="#fonti">Verifica copertura e fonti</a>' : ''}</p><div id="player-list">${playerList()}</div>
    </section>
    <div id="comparison">${comparison()}</div>`;
}
function stat(label, value) {
  return `<div class="detail-stat"><small>${label}</small><strong>${value}</strong></div>`;
}
function historyChart(rows, fields, labels, baseMax = 1, title = 'Andamento') {
  const data = rows.filter(row => Number.isInteger(row.round)).sort((a,b) => a.round - b.round).slice(-10);
  if (!data.some(row => fields.some(key => Number.isFinite(row[key])))) return empty('Nessun valore storico acquisito.');
  const max = Math.max(baseMax, ...data.flatMap(row => fields.map(key => row[key]).filter(Number.isFinite))) * 1.13;
  const from = data[0].round;
  const to = data.at(-1).round;
  const x = r => from === to ? 266 : 38 + 456 * (r - from) / (to - from);
  const y = v => 111 - Math.max(0, v) * 89 / max;
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
  const availabilityLabels = { out: 'Indisponibile', doubtful: 'In dubbio', available: 'Disponibile', reported: 'Segnalata', unknown: 'Mancante' };
  const availability = a.availability?.status ?? 'unknown';
  const projected = a.projection;
  const components = a.components.filter(c => Number.isFinite(c.value));
  const added = modeState().roster.includes(p.id);
  const opponent = a.fixture ? getTeam(a.fixture.homeId === p.teamId ? a.fixture.awayId : a.fixture.homeId) : null;
  dialog.innerHTML = `<button class="dialog-close" data-close-dialog aria-label="Chiudi scheda">✕</button>
    <div class="eyebrow">${mode === 'demo' ? 'Demo · ' : ''}${html(getTeam(p.teamId)?.shortName)} · ${ROLES[p.position] ?? 'Ruolo mancante'}</div><h2 id="player-title">${html(p.name)}</h2>
    ${p.id.startsWith('csv:') ? '<p class="inline-status">Nome, squadra e ruolo provengono dal tuo CSV. Le statistiche di listone sono mancanti.</p>' : ''}
    <div class="detail-grid">
      ${stat('Minuti', number(p.minutes))}${stat('Presenze', number(p.appearances))}${stat('Gol', number(p.goals))}${stat('Assist', number(p.assists))}
      ${stat('xG', number(p.xg, 2))}${stat('xA', number(p.xa, 2))}${stat('xG / 90', number(per90(p.xg, p.minutes), 2))}${stat('xA / 90', number(per90(p.xa, p.minutes), 2))}
      ${stat('Tiri', number(p.shots))}${stat('npxG', number(p.npxg, 2))}${stat('Ammonizioni', number(p.yellowCards))}${stat('Titolarità', number(p.starts))}
    </div>
    <div class="actions"><button data-add="${html(p.id)}" ${added ? 'disabled' : ''}>${added ? 'Nella tua rosa' : 'Aggiungi alla rosa'}</button></div>
    <section class="dialog-section"><h3>Schierabilità · Giornata ${round}</h3>
      <p class="muted">${opponent ? `Avversaria · ${html(opponent.shortName)} · ` : ''}Disponibilità ${html(availabilityLabels[availability] ?? 'Mancante')}${a.availability?.reason ? ` · ${html(a.availability.reason)}` : ''}</p>
      <div class="detail-grid">${stat('Indice / 100', number(a.index))}${stat('Copertura', percent(a.coverage))}${stat('Prob. di giocare', percent(projected?.appearanceProbability))}${stat('Fantapunti attesi', number(a.expectedPoints, 2))}</div>
      ${components.map(c => `<div class="duel"><strong>${html(c.label)} · ${number(c.value)}/100</strong><div class="meter" aria-hidden="true"><span style="width:${Math.min(100, Math.max(0, c.value))}%"></span></div><p>Peso effettivo ${number(c.effectiveWeight)}% · contributo ${number(c.contribution, 1)} punti. ${html(c.detail)}</p></div>`).join('')}
      ${a.notes.length ? `<ul class="muted">${a.notes.map(note => `<li>${html(note)}</li>`).join('')}</ul>` : ''}
    </section>
    ${games.length ? `<section class="dialog-section"><h3>xG e xA per giornata</h3>${historyChart(games, ['xg','xa'], ['xG','xA'], 1, 'Andamento xG e xA')}</section>` : ''}
    ${votes.length ? `<section class="dialog-section"><h3>Voto e fantavoto FantaTB</h3>${historyChart(votes, ['rating','fantasyRating'], ['Voto','Fantavoto'], 8, 'Andamento voti FantaTB')}</section>` : ''}
    ${!games.length && !votes.length ? '<p class="inline-status">Storico individuale mancante.</p>' : ''}
    ${!games.length && votes.length ? '<p class="inline-status">Serie per giornata di xG e xA mancante.</p>' : ''}
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
    notify('Rosa demo e formazione di esempio caricate.');
  } else notify('I giocatori demo sono in rosa. La formazione già salvata è stata conservata.');
  round = state.round = demo.round;
  simulationResult = undefined;
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
  for (const record of Object.values(state.lineups)) {
    record.starters = record.starters.filter(value => value !== id);
    record.reserves = record.reserves.filter(value => value !== id);
  }
  simulationResult = undefined;
  save();
  render();
  notify('Calciatore rimosso dalla rosa e dalle formazioni salvate.');
}
function setLineupRole(id, role) {
  const record = lineup();
  const player = getPlayer(id);
  if (!modeState().roster.includes(id) || !player) return;
  if (role === 'starter') {
    const count = groupPlayers(record.starters).filter(p => p.position === player.position && p.id !== id).length;
    const need = validateLineup([], record.formation).required[player.position] ?? 0;
    if (count >= need || record.starters.length >= 11) {
      notify('Il reparto è pieno per il modulo selezionato.');
      render();
      return;
    }
  }
  record.starters = record.starters.filter(value => value !== id);
  record.reserves = record.reserves.filter(value => value !== id);
  if (role === 'starter') record.starters.push(id);
  if (role === 'reserve') record.reserves.push(id);
  simulationResult = undefined;
  save();
  render();
  Array.from(document.querySelectorAll('[data-lineup-role]')).find(element => element.dataset.lineupRole === id)?.focus({ preventScroll: true });
}
function moveReserve(id, direction) {
  const reserves = lineup().reserves;
  const index = reserves.indexOf(id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= reserves.length) return;
  [reserves[index], reserves[next]] = [reserves[next], reserves[index]];
  simulationResult = undefined;
  save();
  render();
}
function pitch(record, validation) {
  return `<div class="pitch" role="group" aria-label="Formazione ${html(record.formation)} sul campo">${['FWD', 'MID', 'DEF', 'GK'].map(role => {
    const picked = groupPlayers(record.starters).filter(p => p.position === role);
    const missing = Math.max(0, (validation.required[role] ?? 0) - picked.length);
    return `<div class="pitch-row" aria-label="${ROLES[role]}">${picked.map(p => `<div class="pitch-player"><span>${SHORT[role]}</span><span>${html(p.name)}</span></div>`).join('')}
      ${Array.from({ length: missing }, () => `<div class="pitch-player vacant"><span>${SHORT[role]}</span><span>Libero</span></div>`).join('')}</div>`;
  }).join('')}</div>`;
}
function rosa() {
  const state = modeState();
  const record = lineup();
  const starters = groupPlayers(record.starters);
  const roster = groupPlayers(state.roster);
  const validation = validateLineup(starters, record.formation);
  const reserves = groupPlayers(record.reserves);
  const choices = dataset.players.filter(p => !state.roster.includes(p.id)).sort((a,b) => a.name.localeCompare(b.name,'it'));
  const presetButton = mode === 'demo' && dataset.demoPreset
    ? '<button class="primary" data-load-preset>Carica rosa demo</button>'
    : '<a class="btn" href="#mercato">Apri il mercato</a>';
  return `${heading('La mia rosa', 'Organizza titolari e panchina per giornata. Le modifiche vengono salvate su questo browser.', presetButton)}
  <div class="split">
    <section class="panel"><div class="panel-head"><div><h2>Rosa</h2><p>${roster.length} calciatori selezionati</p></div><a class="text-link" href="#giocatori">Apri il listone →</a></div>
      ${choices.length ? `<form class="roster-add" id="roster-add"><label class="field-label">Aggiungi dal listone<select id="roster-choice" required><option value="">Seleziona calciatore</option>${choices.map(p => `<option value="${html(p.id)}">${html(p.name)} · ${html(getTeam(p.teamId)?.shortName)} · ${SHORT[p.position] ?? '—'}</option>`).join('')}</select></label><button type="submit">Aggiungi</button></form>` : ''}
      ${roster.length ? `<ul class="roster-list">${roster.map(p => {
        const active = record.starters.includes(p.id) ? 'starter' : record.reserves.includes(p.id) ? 'reserve' : 'none';
        return `<li><span class="team-code">${SHORT[p.position] ?? '—'}</span><button class="player-name" data-player="${html(p.id)}">${html(p.name)}</button>
          ${p.id.startsWith('csv:') ? status('Da CSV · senza statistiche', 'partial') : ''}
          <select data-lineup-role="${html(p.id)}" aria-label="Impiego di ${html(p.name)}">${[['none','Fuori'],['starter','Titolare'],['reserve','Panchina']].map(([key,label]) => `<option value="${key}" ${key === active ? 'selected' : ''}>${label}</option>`).join('')}</select>
          <button data-remove="${html(p.id)}" aria-label="Rimuovi ${html(p.name)}">✕</button></li>`;
      }).join('')}</ul>` : empty('Aggiungi calciatori dal listone o importa un CSV.')}
      ${state.roster.length !== roster.length ? `<p class="inline-status">${state.roster.length - roster.length} ID salvati non compaiono nello snapshot corrente. Restano nel backup.</p>` : ''}
      <div class="file-actions"><label class="btn button-file">Importa rosa CSV<input type="file" accept=".csv,text/csv" id="roster-csv" aria-label="Importa rosa CSV"></label>
      <button data-csv-template>Modello CSV</button><button data-export>Esporta backup</button>
      <label class="btn button-file">Importa backup<input type="file" accept=".json,application/json" id="backup-json" aria-label="Importa backup"></label></div>
      <p class="inline-status">Puoi usare l’export Classic di Fantacalcio.it o il modello CSV. L’importazione aggiunge i calciatori alla rosa salvata.</p>
      ${importReport ? `<div class="notice neutral"><p role="status">${html(importReport.message)}</p>
        ${importReport.unresolved?.length ? `<details><summary>Righe da verificare</summary><ul>
          ${importReport.unresolved.slice(0, 50).map(row => `<li>${html(row.label)} · ${html(row.reason)}</li>`).join('')}
          ${importReport.unresolved.length > 50 ? '<li>Mostrate le prime 50 righe.</li>' : ''}
        </ul></details>` : ''}</div>` : ''}
    </section>
    <section class="panel">
      <div class="panel-head"><div><h2>Formazione</h2><p>Giornata ${round}</p></div>${status(validation.valid ? '11 titolari validi' : `${starters.length} / 11 titolari`, validation.valid ? 'available' : 'partial')}</div>
      <div class="lineup-controls"><label class="field-label">Modulo<select id="formation">${FORMATION_OPTIONS.map(f => `<option value="${f}" ${f === record.formation ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
        <label class="field-label">Max cambi<select id="substitutions">${[0,1,2,3,4,5].map(n => `<option value="${n}" ${n === record.maxSubstitutions ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      ${pitch(record, validation)}
      ${!validation.valid && starters.length ? `<p class="inline-status">${html(validation.errors.join(' '))}</p>` : ''}
      <div class="duel"><h3>Panchina</h3><p>Priorità dall’alto verso il basso. Sostituzioni fra calciatori dello stesso ruolo.</p>
      ${reserves.length ? `<ol class="bench">${reserves.map((p, i) => `<li>${html(p.name)} · ${SHORT[p.position] ?? '—'} <button data-reserve="${html(p.id)}" data-move="-1" aria-label="Sposta ${html(p.name)} in alto" ${i === 0 ? 'disabled' : ''}>↑</button><button data-reserve="${html(p.id)}" data-move="1" aria-label="Sposta ${html(p.name)} in basso" ${i === reserves.length - 1 ? 'disabled' : ''}>↓</button></li>`).join('')}</ol>` : empty('Nessuna riserva selezionata.')}</div>
      <a class="btn primary" href="#simulazione">Vai alla simulazione ${iconSpan('arrow')}</a>
    </section>
  </div>`;
}
function linkRosterPlayer(state, localId, id) {
  const replace = values => [...new Set(values.map(value => value === localId ? id : value))];
  state.roster = replace(state.roster);
  for (const record of Object.values(state.lineups)) {
    record.starters = replace(record.starters);
    record.reserves = replace(record.reserves).filter(value => !record.starters.includes(value));
  }
  delete state.rosterLocals[localId];
  simulationResult = undefined;
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
function restoreBackup(text) {
  const file = JSON.parse(text);
  if (file?.schemaVersion !== 1 || file.season !== '2026/27' || !file.state || typeof file.state !== 'object') {
    throw new Error('Questo file non è un backup FantaLab Pro 2026/27.');
  }
  const incoming = sanitizeBackup(file.state);
  let kept = 0;
  for (const m of ['real', 'demo']) {
    const base = storage[m];
    base.roster = [...new Set([...(base.roster ?? []), ...(incoming[m].roster ?? [])])];
    base.rosterLocals = { ...incoming[m].rosterLocals, ...base.rosterLocals };
    base.lineups ??= {};
    for (const [day, record] of Object.entries(incoming[m].lineups ?? {})) {
      const existing = base.lineups[day];
      if (existing && (existing.starters.length || existing.reserves.length)) kept++;
      else {
        base.lineups[day] = record;
        base.roster = [...new Set([...base.roster, ...record.starters, ...record.reserves])];
      }
    }
    base.round ??= incoming[m].round;
  }
  simulationResult = undefined;
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

function simulatorOutput(result, single = false) {
  if (!result) return empty('I risultati compariranno dopo aver avviato la simulazione.');
  const exclusions = result.excluded?.length ? `<details><summary>Esclusioni per dati insufficienti (${result.excluded.length})</summary><ul>${result.excluded.map(item => `<li>${html(item.name)} · ${html(item.reason)}</li>`).join('')}</ul></details>` : '';
  const notes = result.notes?.length ? `<ul class="muted">${result.notes.map(note => `<li>${html(note)}</li>`).join('')}</ul>` : '';
  if (!Number.isFinite(result.mean)) return `<div class="notice neutral"><strong>Simulazione non disponibile</strong> Servono dati individuali sufficienti e una formazione valida.</div>${notes}${exclusions}`;
  const max = Math.max(1, ...result.histogram.map(bin => bin.count));
  return `<div class="panel-head"><div><h2>Distribuzione dei fantapunti</h2><p>${number(result.iterations)} scenari · seed ${html(result.seed)} · copertura titolari ${percent(result.coverage)}</p></div>
  ${status(mode === 'demo' ? 'Demo' : result.status === 'partial' ? 'Stima parziale' : 'Stima', mode === 'demo' ? 'demo' : 'partial')}</div>
  <div class="detail-grid">${stat('Media',number(result.mean,2))}${stat('10° percentile',number(result.p10,1))}${stat('Mediana',number(result.p50,1))}${stat('90° percentile',number(result.p90,1))}</div>
  <p>Il 10° e il 90° percentile delimitano l’intervallo centrale dell’80% degli scenari.</p>
  <div class="histogram" aria-label="Frequenza per fascia di fantapunti">${result.histogram.map(bin => `<div class="hist-row"><span>${html(bin.label)}</span><div class="meter" aria-hidden="true"><span style="width:${100 * bin.count / max}%"></span></div><span>${percent(bin.count / result.iterations)}</span></div>`).join('')}</div>
  ${single ? '' : notes + exclusions}
  ${single ? '' : `<div class="duel"><h3>Contributi individuali</h3><div class="table-wrap" tabindex="0" role="region" aria-label="Contributi individuali"><table><thead><tr><th>Calciatore</th><th>Impiego</th><th class="numeric">Fantapunti medi</th><th class="numeric">Utilizzato</th></tr></thead><tbody>
  ${result.individual.map(row => `<tr><td>${html(row.name)}</td><td>${row.role === 'starter' ? 'Titolare' : 'Panchina'}</td><td class="numeric">${number(row.mean,2)}</td><td class="numeric">${percent(row.usedProbability)}</td></tr>`).join('')}</tbody></table></div></div>`}`;
}
function simulazione() {
  const record = lineup();
  const starters = groupPlayers(record.starters);
  const validation = validateLineup(starters, record.formation);
  return `${heading('Simulazione', 'Esplora come presenze, bonus e sostituzioni cambiano la distribuzione dei fantapunti.')}
  <div class="split"><section class="panel"><div class="panel-head"><div><h2>Monte Carlo</h2><p>${html(record.formation)} · ${starters.length}/11 titolari · ${record.reserves.length} riserve</p></div></div>
    ${!validation.valid ? `<p class="notice neutral">Imposta 11 titolari compatibili con il modulo. <a href="#rosa" class="text-link">Vai alla rosa →</a></p>` : ''}
    <form id="simulation-form"><div class="form-fields">
      <label class="field-label">Scenari<select name="iterations">${[1000,5000,10000,30000].map(n => `<option value="${n}" ${n === (simulationResult?.iterations || 5000) ? 'selected' : ''}>${number(n)}</option>`).join('')}</select></label>
      <label class="field-label">Seed<input type="number" name="seed" value="${html(simulationResult?.seed ?? 202627)}" min="0" max="4294967295" required></label></div>
      <button class="primary" type="submit" ${validation.valid ? '' : 'disabled'}>Avvia simulazione</button>
    </form>
    <p class="inline-status">Stesso seed, stessi dati e stessa formazione producono lo stesso risultato. <a class="text-link" href="#fonti">Regole del modello</a></p>
    ${mode === 'demo' && dataset.demoPreset ? '<button data-load-preset>Carica rosa demo</button>' : ''}
  </section><section class="panel" id="simulation-output" aria-live="polite">${simulatorOutput(simulationResult)}</section></div>`;
}
function fonti() {
  const sources = dataset.sources.map(source => {
    const href = safeUrl(source.url);
    return `<li>${href ? `<a href="${html(href)}" target="_blank" rel="noopener noreferrer">${html(source.name)}</a>` : html(source.name)}
      ${source.license ? ` · ${html(source.license)}` : ''}${source.updatedAt ? ` · aggiornato ${html(date(source.updatedAt))}` : ''}${source.note ? `<br>${html(source.note)}` : ''}</li>`;
  });
  return `${heading('Fonti e metodo', 'Controlla la provenienza, la copertura e le ipotesi delle stime.')}
  <div class="split"><section class="panel prose"><h2>Provenienza dei dati</h2>
    <p>${dataset.updatedAt ? `Snapshot elaborato il ${html(date(dataset.updatedAt))}.` : 'Data di elaborazione mancante.'} Il trattino indica un dato mancante. Un valore pari a zero viene mostrato come 0.</p>
    ${sources.length ? `<ul>${sources.join('')}</ul>` : ''}
    ${mode === 'real' ? `<h3>Copertura della stagione</h3><p>Lo snapshot può essere parziale. Una partita con data trascorsa e risultato assente viene mostrata come «Risultato mancante». L’assenza di segnalazioni non conferma la disponibilità.</p>` : '<p>Le statistiche demo sono sintetiche e servono per provare tutte le funzioni.</p>'}
    ${coverageRows()}
  </section><section class="panel prose"><h2>Metodo di calcolo</h2>
    <h3>Indice di schierabilità</h3><p>Scala 0–100. Probabilità di giocare 40%, minuti 25%, bonus 25% e avversario 10%. Il peso dei dati disponibili viene riproporzionato e la copertura è mostrata in scheda. Le partite concluse non ricevono una previsione retroattiva.</p>
    <h3>Match Center</h3><p>Difficoltà per reparto stimata da almeno tre risultati precedenti acquisiti per squadra, fino agli ultimi cinque. L’attacco valuta quanto concede l’avversaria, la difesa quanto produce e il centrocampo combina i due segnali. Le stime 1X2 usano un modello Poisson non calibrato.</p>
    <h3>Monte Carlo</h3><p>Voto base 6 in caso di impiego, +3 per un gol, +1 per un assist, −0,5 per un’ammonizione e −1 per gol subito dal portiere quando stimabili. Il modello usa sostituzioni per ruolo e ignora modificatori, rigori e correlazioni fra giocatori.</p>
    <h3>xG e xA</h3><p>xG stima la qualità dei tiri. xA stima la qualità delle occasioni create. I valori per 90 minuti si calcolano con minuti positivi e metriche acquisite.</p>
  </section></div>`;
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
  const roster = modeState().roster;
  const rosterKey = roster.join('\0');
  if (marketCache?.dataset === dataset && marketCache.round === round && marketCache.rosterKey === rosterKey) {
    return marketCache.result;
  }
  const result = buildMarket({
    listone: marketImports.listone?.rows ?? [],
    freeAgents: marketImports.svincolati?.rows ?? [],
    roster: groupPlayers(roster),
    dataset, round,
    analyze: player => playerAnalysis(player)
  });
  marketCache = { dataset, round, rosterKey, result };
  return result;
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
    ${source ? `<button data-market-clear="${kind}" aria-label="Rimuovi ${label}">Rimuovi</button>` : ''}</div></section>`;
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
  return `<article class="market-comparison">
    <div class="panel-head"><h3><span class="muted">${html(outgoing.name)}</span> <span aria-label="in cambio di">→</span> ${html(incoming.name)}</h3>${status(label, tone)}</div>
    <div class="market-facts"><span>Indice ${marketDelta(delta.score)} pt</span><span>FM corretta ${marketDelta(delta.adjustedFantasy,2)}</span><span>Partite a voto ${marketDelta(delta.appearances)}</span>${Number.isFinite(delta.expectedPoints) ? `<span>Fantapunti attesi ${marketDelta(delta.expectedPoints,2)}</span>` : ''}</div>
    <p>${html(ROLES[incoming.position] ?? 'Ruolo mancante')} · ${html(marketClub(incoming))} · FM ${number(incoming.fantasyAverage,2)} su ${number(incoming.appearances)} voti · quotazione ${number(incoming.price)}</p>
    ${trade && Number.isFinite(credit) ? `<p>Conguaglio indicato · ${credit === 0 ? 'nessuno' : `${number(Math.abs(credit))} crediti ${credit > 0 ? 'a tuo carico' : 'in entrata'}`}</p>` : ''}
    <details><summary>Come si confrontano</summary><div class="table-wrap"><table>
      <thead><tr><th>Indicatore</th><th class="numeric">In uscita</th><th class="numeric">In entrata</th></tr></thead>
      <tbody>
        ${[['Indice',outgoing.score,incoming.score,0],['FM su partite a voto',outgoing.fantasyAverage,incoming.fantasyAverage,2],
          ['FM corretta per campione',outgoing.adjustedFantasy,incoming.adjustedFantasy,2],
          ['Partite a voto',outgoing.appearances,incoming.appearances,0],['Quotazione',outgoing.price,incoming.price,0]]
          .map(([name,before,after,digits]) => `<tr><th scope="row">${name}</th><td class="numeric">${number(before,digits)}</td><td class="numeric">${number(after,digits)}</td></tr>`).join('')}
      </tbody></table></div>
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
    const comparison = outgoing && marketFilters.incoming
      ? compareMarketTrade(market, outgoing.key, marketFilters.incoming, { creditDifference: creditInput(marketFilters.credits) }) : null;
    return `${rosterHint}${outgoing ? '' : '<p class="inline-status">Seleziona un giocatore in uscita per confrontare uno scambio a parità di ruolo.</p>'}
      ${marketCard(comparison,true)}${marketList(assigned,null,Boolean(outgoing))}`;
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
  if (mode === 'demo') return `${heading('Mercato', 'Analizza gli svincolati e gli scambi della tua lega.')}
    <section class="panel"><p>Gli Excel della lega si caricano in modalità Dati reali.</p><button data-mode="real">Passa ai dati reali</button></section>`;
  const market = getMarket();
  const coverage = market.coverage;
  return `${heading('Mercato', 'Cerca possibili miglioramenti tra gli svincolati e confronta gli scambi per ruolo.')}
    <div class="market-inputs">${Object.keys(MARKET_UPLOADS).map(marketImportCard).join('')}</div>
    <p class="inline-status">Gli Excel e le assegnazioni restano su questo browser. Il listone della lega è disponibile in questa sezione.</p>
    ${coverage.catalog ? `<div class="market-facts market-coverage" aria-label="Copertura analisi">
      ${coverage.roster ? `<span>Rosa collegata ${number(coverage.matchedRoster)}/${number(coverage.roster)}</span>` : ''}
      ${marketImports.svincolati ? `<span>${number(coverage.eligibleFreeAgents)} svincolati candidabili</span><span>${number(coverage.unscoredFreeAgents)} senza indice</span>` : ''}
      ${coverage.conflictingFreeAgents ? `<span>${number(coverage.conflictingFreeAgents)} righe discordanti escluse</span>` : ''}
    </div>` : ''}
    ${marketNotice ? `<p class="notice neutral" role="status">${html(marketNotice)}</p>` : ''}
    <section class="panel market-workbench">
      <div class="panel-head"><div><h2>${MARKET_TABS[marketFilters.tab]}</h2><p>${marketFilters.tab === 'riparazione'
        ? 'Il filtro usa la quotazione di riferimento. Il prezzo effettivo dipende dalla tua asta.'
        : marketFilters.tab === 'scambi' ? 'Un confronto alla volta tra giocatori dello stesso ruolo. Conguaglio positivo se paghi, negativo se incassi.'
        : 'Cerca tra tutti i giocatori dell’Excel, compresi quelli fuori lista.'}</p></div></div>
      <div class="mode-switch market-tabs" role="group" aria-label="Sezione mercato">${Object.entries(MARKET_TABS).map(([id,label]) =>
        `<button type="button" data-market-tab="${id}" aria-pressed="${id === marketFilters.tab}">${label}</button>`).join('')}</div>
      ${marketToolbar(market)}
      <div id="market-results">${marketResults(market)}</div>
      <details class="market-method"><summary>Fonti e metodo dell’indice</summary>
        <p>Il confronto usa fantamedia e partite a voto dell’Excel. La fantamedia corretta si avvicina al valore tipico del ruolo quando il campione è piccolo. Quotazioni e FVM sono riferimenti del file. Il trattino indica un dato mancante.</p>
        ${market.notes.length ? `<ul>${market.notes.map(note => `<li>${html(note)}</li>`).join('')}</ul>` : ''}
      </details>
    </section>`;
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
  window.scrollTo(0,0);
  $('#workspace').focus({ preventScroll: true });
}
function wireEvents() {
  for (const element of document.querySelectorAll('[data-icon]')) element.innerHTML = icon(element.dataset.icon);
  window.addEventListener('hashchange', () => {
    const hash = location.hash.slice(1);
    if (Object.hasOwn(PAGES, hash) || !hash) setPage(currentPage());
  });
  window.addEventListener('storage', event => {
    const kind = event.key?.startsWith(MARKET_KEY) ? event.key.slice(MARKET_KEY.length) : null;
    if (!Object.hasOwn(MARKET_UPLOADS,kind)) return;
    marketImports[kind] = readMarketSource(kind);
    marketCache = undefined;
    if (page === 'mercato' && mode === 'real') render();
  });
  dialog.addEventListener('close', () => lastFocus?.isConnected && lastFocus.focus());
  document.addEventListener('click', event => {
    const control = event.target.closest('button');
    if (!control) return;
    const data = control.dataset;
    if (data.mode) { if (data.mode !== mode || pageView.getAttribute('aria-busy') === 'true') { importReport = undefined; void switchMode(data.mode); } return; }
    if (!dataset) return;
    if (data.fixture) {
      selectedFixtureId = data.fixture;
      if (page === 'match') {
        const detail = $('#match-detail');
        detail.innerHTML = matchCard(byRound().find(f => f.id === selectedFixtureId));
        for (const button of document.querySelectorAll('[data-fixture]')) {
          if (button.dataset.fixture === selectedFixtureId) button.setAttribute('aria-current','true');
          else button.removeAttribute('aria-current');
        }
        if (window.matchMedia('(max-width: 590px)').matches) detail.scrollIntoView({ block: 'start' });
      } else location.hash = 'match';
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
        dataset, mode, round, iterations: 5000, seed: 202627, maxSubstitutions: 0
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
    if ('export' in data) download(JSON.stringify({schemaVersion:1,season:'2026/27',state:storage},null,2), 'fantalab-pro-backup.json','application/json');
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
    if (event.target.dataset.marketFile) {
      const file = event.target.files?.[0];
      if (file) await importMarketFile(event.target.dataset.marketFile, file);
      return;
    }
    const marketFilter = {'market-role':'role','market-outgoing':'outgoing','market-budget':'budget','market-credits':'credits'}[id];
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
      if (event.target.checked && selectedComparison[mode].length >= 2) {
        event.target.checked = false;
        notify('Deseleziona un calciatore prima di confrontarne un altro.');
      } else {
        selectedComparison[mode] = event.target.checked ? [...selectedComparison[mode], compare] : selectedComparison[mode].filter(value => value !== compare);
        $('#comparison').innerHTML = comparison();
      }
    }
    if (event.target.dataset.lineupRole) setLineupRole(event.target.dataset.lineupRole, value);
    if (id === 'formation' && FORMATION_OPTIONS.includes(value)) { lineup().formation = value; simulationResult = undefined; save(); render(); $('#formation').focus(); }
    if (id === 'substitutions') { lineup().maxSubstitutions = Number(value); simulationResult = undefined; save(); }
    if (id === 'roster-csv' || id === 'backup-json') {
      const file = event.target.files?.[0];
      if (!file) return;
      const activeMode = mode;
      try {
        if (file.size > 2_000_000) throw new Error('Il file supera 2 MB.');
        const text = id === 'roster-csv' ? decodeRosterCsv(await file.arrayBuffer()) : await file.text();
        if (activeMode !== mode) return;
        importReport = id === 'roster-csv' ? importCsv(text) : { message: restoreBackup(text) };
      } catch (error) { importReport = { message: error instanceof SyntaxError ? 'Backup JSON non valido.' : error.message }; }
      render();
    }
  });
  document.addEventListener('submit', event => {
    if (event.target.id === 'roster-add') {
      event.preventDefault();
      addPlayer($('#roster-choice').value);
      render();
      $('#roster-choice')?.focus();
    }
    if (event.target.id === 'simulation-form') {
      event.preventDefault();
      const data = new FormData(event.target);
      const record = lineup();
      simulationResult = simulateLineup(groupPlayers(record.starters), {
        dataset, mode, round, formation: record.formation, reserves: groupPlayers(record.reserves),
        maxSubstitutions: record.maxSubstitutions, iterations: Number(data.get('iterations')), seed: Number(data.get('seed'))
      });
      $('#simulation-output').innerHTML = simulatorOutput(simulationResult);
    }
  });
}
wireEvents();
void switchMode('real');
