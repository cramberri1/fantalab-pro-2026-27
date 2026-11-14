const DATABASE = 'fantalab-voti-personali-v1';
const KEY = 'archive';
const SEASONS = new Set(['2025/26', '2026/27']);
const EDITIONS = ['Fantacalcio', 'Statistico', 'Italia'];
const EVENTS = ['goals','penaltyScored','penaltySaved','penaltyMissed','ownGoal','goalsConceded','yellowCard','redCard','assist'];

export function cleanOfficialArchive(value) {
  const validLabel = (text, length) => typeof text === 'string' && text.length > 0 && text.length <= length;
  const days = new Map();
  for (const day of Array.isArray(value?.days) ? value.days.slice(0,76) : []) {
    if (!SEASONS.has(day?.season) || !Number.isInteger(day.round) || day.round < 1 || day.round > 38 ||
      !Array.isArray(day.rows) || day.rows.length > 1000 || !Array.isArray(day.teamIds)) continue;
    const teamIds = [...new Set(day.teamIds.filter(id => validLabel(id,50)))].slice(0,20);
    const codes = new Set();
    const rows = [];
    for (const row of day.rows) {
      if (!row || !validLabel(row.code,20) || !/^\d+$/.test(row.code) || codes.has(row.code) ||
        !validLabel(row.name,140) || !teamIds.includes(row.teamId) || !['GK','DEF','MID','FWD'].includes(row.position) ||
        !EDITIONS.every(edition => Array.isArray(row.votes?.[edition]) &&
          Number.isFinite(row.votes[edition][0]) && row.votes[edition][0] >= 0 && row.votes[edition][0] <= 10) ||
        !EVENTS.every(event => Number.isInteger(row.events?.[event]) && row.events[event] >= 0 && row.events[event] < 100)) continue;
      codes.add(row.code);
      rows.push({
        id:validLabel(row.id,120) ? row.id : null, code:row.code, name:row.name, teamId:row.teamId,
        position:row.position, votes:Object.fromEntries(EDITIONS.map(edition => [edition,[row.votes[edition][0],row.votes[edition][1] === true]])),
        events:Object.fromEntries(EVENTS.map(event => [event,row.events[event]])),
      });
    }
    if (!rows.length || rows.length !== day.rows.length) continue;
    const unmatched = Array.isArray(day.unmatched) ? day.unmatched.slice(0,1000).filter(row => codes.has(row?.code)).map(row => ({
      code:row.code, teamId:teamIds.includes(row.teamId) ? row.teamId : null, position:['GK','DEF','MID','FWD'].includes(row.position) ? row.position : null,
      name:validLabel(row.name,140) ? row.name : '', reason:validLabel(row.reason,300) ? row.reason : '',
      ambiguous:row.ambiguous === true, candidateIds:Array.isArray(row.candidateIds) ? row.candidateIds.filter(id => validLabel(id,120)).slice(0,20) : []
    })) : [];
    const unmatchedCodes = new Set(unmatched.map(row => row.code));
    for (const row of rows) if (!row.id && !unmatchedCodes.has(row.code)) {
      unmatched.push({ code:row.code, teamId:row.teamId, position:row.position, name:row.name,
        reason:'Calciatore non abbinato', ambiguous:false, candidateIds:[] });
    }
    const warnings = Array.isArray(day.warnings) ? day.warnings.filter(item => validLabel(item,350)).slice(0,30) : [];
    days.set(`${day.season}:${day.round}`, { season:day.season, round:day.round, teamIds, rows, unmatched, warnings,
      complete:teamIds.length === 20, readRows:Number.isInteger(day.readRows) ? day.readRows : rows.length,
      ignoredCoaches:Number.isInteger(day.ignoredCoaches) ? day.ignoredCoaches : 0,
      codeCoverage:Number.isFinite(day.codeCoverage) && day.codeCoverage >= 0 && day.codeCoverage <= 1 ? day.codeCoverage : null });
  }
  return { edition:EDITIONS.includes(value?.edition) ? value.edition : 'Fantacalcio', days:[...days.values()] };
}

function openVault() {
  return new Promise((resolve,reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Archivio locale non disponibile.'));
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('votes');
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => reject(new Error('Archivio locale non accessibile.'));
  });
}

export async function readOfficialArchive() {
  const database = await openVault();
  try {
    const value = await new Promise((resolve,reject) => {
      const request = database.transaction('votes','readonly').objectStore('votes').get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Archivio locale non leggibile.'));
    });
    return { ...cleanOfficialArchive(value), revision:Number.isSafeInteger(value?.revision) ? value.revision : 0 };
  } finally { database.close(); }
}

export async function writeOfficialArchive(value, revision) {
  const database = await openVault();
  try {
    return await new Promise((resolve,reject) => {
      const transaction = database.transaction('votes','readwrite');
      const store = transaction.objectStore('votes');
      const existing = store.get(KEY);
      const nextRevision = revision + 1;
      transaction.oncomplete = () => resolve(nextRevision);
      transaction.onabort = () => reject(new Error('Archivio locale non salvato.'));
      existing.onsuccess = () => {
        if ((existing.result?.revision ?? 0) !== revision) {
          const conflict = new Error('L’archivio è stato aggiornato in un’altra scheda. Riprova.');
          conflict.code = 'ARCHIVE_CHANGED';
          reject(conflict);
          transaction.abort();
        } else store.put({ ...value, revision:nextRevision }, KEY);
      };
    });
  } finally { database.close(); }
}
