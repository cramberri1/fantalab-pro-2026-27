const romeCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
});
const settled = new Set(['played', 'cancelled']);

function romeDay(date) {
  const parts = Object.fromEntries(romeCalendar.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function fixtureCalendarDay(fixture) {
  const kickoff = Date.parse(fixture.kickoff);
  return Number.isFinite(kickoff) ? romeDay(kickoff) : fixture.date ?? null;
}

export function isPendingFixture(fixture, now = new Date()) {
  if (fixture.status === 'live') return true;
  if (fixture.status !== 'scheduled') return false;
  const kickoff = Date.parse(fixture.kickoff);
  if (Number.isFinite(kickoff)) return kickoff >= Number(now);
  const day = fixtureCalendarDay(fixture);
  return !day || day >= romeDay(now);
}

export function getRoundWindow(dataset, now = new Date()) {
  const gamesByRound = new Map();
  for (const fixture of dataset.fixtures) {
    if (!Number.isInteger(fixture.round)) continue;
    if (!gamesByRound.has(fixture.round)) gamesByRound.set(fixture.round, []);
    gamesByRound.get(fixture.round).push(fixture);
  }
  const rounds = [...gamesByRound.keys()].sort((a, b) => a - b);
  const pending = new Map();
  for (const round of rounds) {
    const days = gamesByRound.get(round).filter(fixture => dataset.mode === 'demo'
      ? ['scheduled', 'live'].includes(fixture.status) : isPendingFixture(fixture, now)
    ).map(fixture => fixture.status === 'live' ? '' : fixtureCalendarDay(fixture) ?? '9999-99-99');
    if (days.length) pending.set(round, days.sort()[0]);
  }
  const withResults = rounds.filter(round => gamesByRound.get(round).some(fixture => fixture.status === 'played'));
  const lastPast = withResults.filter(round => !pending.has(round)).at(-1);
  const byPendingDate = [...pending.keys()].sort((a, b) => pending.get(a).localeCompare(pending.get(b)) || a - b);
  const next = byPendingDate.find(round => lastPast == null || round > lastPast) ?? byPendingDate[0] ?? null;
  const latest = withResults.filter(round => round !== next && (!pending.has(round) || round < next)).at(-1) ?? null;
  const demoRound = dataset.mode === 'demo' && gamesByRound.has(dataset.demoPreset?.round)
    ? dataset.demoPreset.round : null;
  return {
    next,
    latest,
    nextStarted: next != null && gamesByRound.get(next).some(fixture => ['played', 'live'].includes(fixture.status)),
    latestComplete: latest != null && gamesByRound.get(latest).every(fixture => settled.has(fixture.status)),
    defaultRound: demoRound ?? next ?? latest ?? rounds[0] ?? 1
  };
}
