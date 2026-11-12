const MARKET_POSITIONS = new Set(['GK', 'DEF', 'MID', 'FWD']);
const PRIOR_MATCHES = 6;
const MIN_VOTES = 3;
const SIGNAL_GAP = 5;

const marketNumber = value => typeof value === 'number' && Number.isFinite(value);
const observed = value => marketNumber(value) && value >= 0 ? value : null;
const matchCount = value => Number.isInteger(value) && value >= 0 ? value : null;
const label = value => String(value ?? '').trim();
const normalized = value => label(value).normalize('NFKD').replace(/\p{Mark}/gu, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const rowsOf = imported => {
  const rows = imported?.rows ?? imported;
  return Array.isArray(rows) ? rows : [];
};
const clamp100 = value => Math.min(100, Math.max(0, value));

function groupBy(values, keyFor) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFor(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  }
  return groups;
}

function teamLookup(teams) {
  const aliases = new Map();
  for (const team of teams) {
    for (const alias of [team.id, team.name, team.shortName, team.code].map(normalized).filter(Boolean)) {
      if (!aliases.has(alias)) aliases.set(alias, new Set());
      aliases.get(alias).add(team.id);
    }
  }
  return team => {
    const hits = aliases.get(normalized(team));
    return hits?.size === 1 ? [...hits][0] : null;
  };
}

function rowIdentity(row, lookupTeam) {
  const workbookId = label(row.id) || null;
  const teamId = lookupTeam(row.team);
  const name = label(row.name);
  const team = label(row.team);
  const position = MARKET_POSITIONS.has(row.position) ? row.position : null;
  const identity = [teamId ?? normalized(team), position, normalized(name)].join(':');
  return { row, workbookId, teamId, name, team, position, identity, key: workbookId ? 'fc:' + workbookId : 'name:' + identity };
}

function indexWorkbook(rows, lookupTeam) {
  const records = rows.map(row => rowIdentity(row, lookupTeam));
  const keys = groupBy(records, record => record.key);
  const identities = groupBy(records, record => record.identity);
  return { keys, identities };
}

function workbookMatches(record, other) {
  const sameKey = other.keys.get(record.key);
  if (sameKey) return sameKey;
  if (!record.name || !record.team || !record.position) return [];
  return other.identities.get(record.identity) ?? [];
}

function idsConflict(first, second) {
  return Boolean(first?.workbookId && second?.workbookId && first.workbookId !== second.workbookId);
}

function workbookCatalog(listone, freeAgents, lookupTeam) {
  const complete = indexWorkbook(listone, lookupTeam);
  const free = indexWorkbook(freeAgents, lookupTeam);
  const profiles = [];
  const pairedFree = new Set();

  for (const records of complete.keys.values()) {
    const record = records[0];
    const freeMatches = workbookMatches(record, free);
    for (const counterpart of freeMatches) pairedFree.add(counterpart.key);
    const counterpart = freeMatches[0];
    const conflict = records.length > 1 || freeMatches.length > 1
      || Boolean(counterpart && (counterpart.identity !== record.identity || idsConflict(record, counterpart)));
    profiles.push(makeProfile(record, 'listone', counterpart, conflict));
  }

  for (const records of free.keys.values()) {
    const record = records[0];
    if (!pairedFree.has(record.key)) {
      profiles.push(makeProfile(record, 'svincolati', record, records.length > 1));
    }
  }
  return profiles;
}

function makeProfile(record, source, freeRecord, conflict) {
  const { key, workbookId, teamId, name, team, position, row } = record;
  const offList = row.offList === true || freeRecord?.row.offList === true;
  const owner = label(row.fantasyTeam) || label(freeRecord?.row.fantasyTeam) || null;
  const freeListed = Boolean(freeRecord);
  let availability = 'unconfirmed';
  if (offList) availability = 'off-list';
  else if (conflict || freeListed && owner) availability = 'conflict';
  else if (freeListed) availability = 'free';
  else if (owner) availability = 'owned';
  const appearances = matchCount(row.appearances);

  return {
    key, playerKey: key, rosterId: null, name, team, teamId, position, workbookId, datasetId: null,
    source, availability, owner, offList, freeListed, resolution: null, price: observed(row.price),
    fvm: observed(row.fvm), cost: observed(row.cost), appearances,
    averageRating: appearances > 0 ? observed(row.averageRating) : null,
    fantasyAverage: appearances > 0 ? observed(row.fantasyAverage) : null,
    adjustedFantasy: null, baselineFantasy: null, score: null, components: { quality: null, volume: null },
    confidence: appearances === null ? null : appearances / (appearances + PRIOR_MATCHES),
    expectedPoints: null, fixture: null, absenceStatus: null
  };
}

function abbreviationOf(shortName, fullName) {
  const short = normalized(shortName).split(' ');
  const full = normalized(fullName).split(' ');
  if (!short[0] || !full[0]) return false;
  const fullCompact = full.join('');
  const shortCompact = short.join('');
  if (fullCompact === shortCompact) return true;
  const initial = full[0][0];
  const hasFinalInitial = short.length > 1 && short.at(-1) === initial;
  const hasLeadingInitial = short.length > 1 && short[0] === initial;
  for (let index = 1; index < full.length; index++) {
    const suffix = full.slice(index).join('');
    if (suffix === shortCompact
      || (hasFinalInitial && suffix === short.slice(0, -1).join(''))
      || (hasLeadingInitial && suffix === short.slice(1).join(''))) return true;
  }
  return false;
}

function identityMatches(name, candidates) {
  const nameKey = normalized(name);
  if (!nameKey) return [];
  const exact = candidates.filter(candidate => normalized(candidate.name) === nameKey);
  if (exact.length) return exact;
  return candidates.filter(candidate => abbreviationOf(name, candidate.name) || abbreviationOf(candidate.name, name));
}

function marketScope(record) {
  return record.teamId + ':' + record.position;
}

function attachProjection(profile, publicPlayers, dataset, round, analyze) {
  if (!profile.teamId || !profile.position) return profile;
  const matches = identityMatches(profile.name, publicPlayers.get(marketScope(profile)) ?? []);
  if (matches.length !== 1) return profile;
  const player = matches[0];
  profile.datasetId = player.id;
  if (typeof analyze !== 'function') return profile;
  const analysis = analyze(player, { dataset, round, mode: dataset.mode });
  if (!analysis?.fixture || analysis.status === 'historical') return profile;
  profile.expectedPoints = marketNumber(analysis.expectedPoints) ? analysis.expectedPoints : null;
  profile.fixture = analysis.fixture;
  profile.absenceStatus = analysis.availability?.status ?? null;
  return profile;
}

function roleBaselines(catalog) {
  const byPosition = groupBy(catalog.filter(profile => !profile.offList && profile.availability !== 'conflict'
    && profile.position && profile.appearances > 0 && profile.fantasyAverage !== null), profile => profile.position);
  return new Map([...byPosition].map(([position, group]) => {
    const appearances = group.reduce((total, profile) => total + profile.appearances, 0);
    const fantasyTotal = group.reduce((total, profile) => total + profile.appearances * profile.fantasyAverage, 0);
    return [position, fantasyTotal / appearances];
  }));
}

function scoreProfiles(catalog) {
  const baselines = roleBaselines(catalog);
  const observedMax = Math.max(0, ...catalog
    .filter(profile => !profile.offList && profile.availability !== 'conflict')
    .map(profile => profile.appearances ?? 0));
  for (const profile of catalog) {
    const { appearances, fantasyAverage, position } = profile;
    const baselineFantasy = baselines.get(position) ?? null;
    profile.baselineFantasy = baselineFantasy;
    if (observedMax > 0 && appearances !== null) {
      profile.components.volume = clamp100(100 * appearances / observedMax);
    }
    if (profile.offList || profile.availability === 'conflict'
      || !(appearances > 0) || fantasyAverage === null || baselineFantasy === null) continue;
    profile.adjustedFantasy = (fantasyAverage * appearances + baselineFantasy * PRIOR_MATCHES)
      / (appearances + PRIOR_MATCHES);
    const quality = clamp100(50 + 25 * (profile.adjustedFantasy - baselineFantasy));
    profile.components.quality = quality;
    if (profile.components.volume !== null) profile.score = 0.65 * quality + 0.35 * profile.components.volume;
  }
  return { observedMax, baselines: Object.fromEntries(baselines) };
}

function linkRoster(roster, catalog, teams) {
  const rosterCandidates = groupBy(catalog.filter(profile => profile.teamId && profile.position), marketScope);
  const teamNames = new Map(teams.map(team => [team.id, team.shortName ?? team.name]));
  const excludedKeys = new Set();
  const profiles = [];
  for (const player of roster) {
    if (!player?.id || !MARKET_POSITIONS.has(player.position)) continue;
    const scope = rosterCandidates.get(marketScope(player)) ?? [];
    const sameId = scope.filter(profile => profile.datasetId === player.id
      || (profile.workbookId && profile.workbookId === label(player.workbookId)));
    const matches = sameId.length ? sameId : identityMatches(player.name, scope);
    for (const candidate of matches) excludedKeys.add(candidate.key);
    const linked = matches.length === 1 && matches[0].availability !== 'conflict' ? matches[0] : null;
    const team = teamNames.get(player.teamId) ?? label(player.team);
    const fallback = makeProfile(rowIdentity({ name: player.name, position: player.position, team }, () => player.teamId),
      null, null, false);
    fallback.datasetId = player.id;
    fallback.playerKey = null;
    profiles.push({
      ...(linked ?? fallback), key: 'roster:' + player.id, rosterId: player.id,
      resolution: linked ? 'matched' : matches.length ? 'ambiguous' : 'missing'
    });
  }
  return { profiles, excludedKeys };
}

export function buildMarket({ listone, freeAgents, roster = [], dataset, round, analyze } = {}) {
  const listRows = rowsOf(listone);
  const freeRows = rowsOf(freeAgents);
  const teams = dataset?.teams ?? [];
  const catalog = workbookCatalog(listRows, freeRows, teamLookup(teams));
  const publicPlayers = groupBy(dataset?.mode === 'real' ? dataset.players ?? [] : [], marketScope);
  for (const profile of catalog) attachProjection(profile, publicPlayers, dataset, round, analyze);
  const { observedMax, baselines } = scoreProfiles(catalog);
  const { profiles, excludedKeys } = linkRoster(roster, catalog, teams);
  const eligible = catalog.filter(profile => profile.availability === 'free' && profile.position
    && profile.name && profile.team && !excludedKeys.has(profile.key));
  const coverage = {
    listoneRows: listRows.length,
    freeAgentRows: freeRows.length,
    catalog: catalog.length,
    roster: profiles.length,
    matchedRoster: profiles.filter(profile => profile.resolution === 'matched').length,
    missingRoster: profiles.filter(profile => profile.resolution === 'missing').length,
    ambiguousRoster: profiles.filter(profile => profile.resolution === 'ambiguous').length,
    eligibleFreeAgents: eligible.length,
    unscoredFreeAgents: eligible.filter(profile => profile.score === null).length,
    offListFreeAgents: catalog.filter(profile => profile.freeListed && profile.offList).length,
    conflictingFreeAgents: catalog.filter(profile => profile.freeListed && profile.availability === 'conflict').length,
    ownedFreeAgents: catalog.filter(profile => profile.freeListed && excludedKeys.has(profile.key)).length,
    fixtureProjections: catalog.filter(profile => profile.expectedPoints !== null).length,
    observedMax, baselines
  };
  const notes = [
    'Indice mercato storico: 65% fantamedia corretta verso la media di ruolo e 35% partite a voto rispetto al massimo osservato.',
    'La correzione della fantamedia pesa la media di ruolo quanto sei gare. Servono almeno tre gare a voto per lato e cinque punti di differenza per indicare un miglioramento.',
    'Quotazione e FVM sono riferimenti del file. Le proiezioni FantaLab, quando disponibili, sono mostrate a parte.'
  ];
  return { catalog, roster: profiles, freeAgents: eligible, coverage, notes, excludedKeys };
}

function difference(incoming, outgoing) {
  return marketNumber(incoming) && marketNumber(outgoing) ? incoming - outgoing : null;
}

function comparisonReason(outgoing, incoming, signal) {
  if (signal === 'insufficient') return 'Per confrontare l’indice servono fantamedia e partite a voto per entrambi.';
  if (signal === 'limited') return 'Almeno uno dei due ha meno di tre partite a voto nel file.';
  if (signal === 'similar') return 'La differenza è inferiore a cinque punti nell’indice storico.';
  const quality = 0.65 * (incoming.components.quality - outgoing.components.quality);
  const volume = 0.35 * (incoming.components.volume - outgoing.components.volume);
  return Math.abs(quality) >= Math.abs(volume)
    ? 'La differenza dipende soprattutto dalla fantamedia corretta per il campione.'
    : 'La differenza dipende soprattutto dal numero di partite a voto.';
}

function comparison(outgoing, incoming, creditDifference = null) {
  const delta = {
    score: difference(incoming.score, outgoing.score),
    fantasyAverage: difference(incoming.fantasyAverage, outgoing.fantasyAverage),
    adjustedFantasy: difference(incoming.adjustedFantasy, outgoing.adjustedFantasy),
    appearances: difference(incoming.appearances, outgoing.appearances),
    expectedPoints: difference(incoming.expectedPoints, outgoing.expectedPoints),
    referencePrice: difference(incoming.price, outgoing.price)
  };
  let signal = 'insufficient';
  if (delta.score !== null) {
    if (Math.min(incoming.appearances, outgoing.appearances) < MIN_VOTES) signal = 'limited';
    else if (delta.score >= SIGNAL_GAP) signal = 'upgrade';
    else if (delta.score <= -SIGNAL_GAP) signal = 'downgrade';
    else signal = 'similar';
  }
  return {
    ok: true, reason: comparisonReason(outgoing, incoming, signal), outgoing, incoming, delta, signal,
    creditDifference: marketNumber(creditDifference) ? creditDifference : null
  };
}

export function rankMarketReplacements(market, outgoingKey, { maxReferencePrice, limit } = {}) {
  const outgoing = market.roster.find(profile => profile.key === outgoingKey) ?? null;
  const sameRole = outgoing ? market.freeAgents.filter(profile => profile.position === outgoing.position) : [];
  const budgetActive = marketNumber(maxReferencePrice) && maxReferencePrice >= 0;
  const excluded = { unknownPrice: 0, overBudget: 0, unscored: 0 };
  const candidates = [];
  for (const profile of sameRole) {
    if (budgetActive && profile.price === null) {
      excluded.unknownPrice++;
      continue;
    }
    if (budgetActive && profile.price > maxReferencePrice) {
      excluded.overBudget++;
      continue;
    }
    if (profile.score === null) excluded.unscored++;
    candidates.push(comparison(outgoing, profile));
  }
  candidates.sort((a, b) => (b.incoming.score ?? -1) - (a.incoming.score ?? -1)
    || (b.incoming.appearances ?? -1) - (a.incoming.appearances ?? -1)
    || a.incoming.name.localeCompare(b.incoming.name, 'it'));
  const total = candidates.length;
  const cap = Number.isInteger(limit) && limit >= 0 ? limit : total;
  return { outgoing, candidates: candidates.slice(0, cap), excluded, total };
}

export function compareMarketTrade(market, outgoingKey, incomingKey, { creditDifference } = {}) {
  const outgoing = market.roster.find(profile => profile.key === outgoingKey) ?? null;
  const incoming = market.catalog.find(profile => profile.key === incomingKey) ?? null;
  const ownTeams = new Set(market.roster.map(profile => profile.owner).filter(Boolean));
  let reason;
  if (!outgoing || !incoming) reason = 'Seleziona entrambi i calciatori.';
  else if (market.excludedKeys.has(incoming.key) || ownTeams.size === 1 && ownTeams.has(incoming.owner)) {
    reason = 'Il calciatore è già in rosa, è della stessa squadra fantasy o coincide con un abbinamento da verificare.';
  } else if (incoming.source !== 'listone') reason = 'Seleziona un calciatore del listone completo per lo scambio.';
  else if (incoming.availability !== 'owned') reason = 'Per lo scambio serve un calciatore assegnato nel listone della lega.';
  else if (incoming.position !== outgoing.position) reason = 'Il confronto uno contro uno richiede lo stesso ruolo Classic.';
  if (reason) return { ok: false, reason, outgoing, incoming, delta: null, signal: 'insufficient', creditDifference: null };
  return comparison(outgoing, incoming, creditDifference);
}
