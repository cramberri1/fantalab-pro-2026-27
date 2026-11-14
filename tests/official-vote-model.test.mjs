import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficialVoteIndex, drawOfficialFantasy, officialFantasyScore } from '../js/official-vote-model.js';

const zeroEvents = { goals: 0, assist: 0, penaltyScored: 0, penaltySaved: 0, penaltyMissed: 0,
  ownGoal: 0, goalsConceded: 0, yellowCard: 0, redCard: 0 };
const player = { id: 'invent-uno', teamId: 'alfa', position: 'FWD' };
const keeper = { id: 'invent-por', teamId: 'alfa', position: 'GK' };
const season = '2026/27';
const edition = 'Fantacalcio';
const row = (person, rating, starred = false, events = {}) => ({
  ...person, votes: { Fantacalcio: [rating, starred], Statistico: [rating + 0.5, starred], Italia: [rating, starred] },
  events: { ...zeroEvents, ...events }
});
const day = (round, rows, extra = {}) => ({ season, round, teamIds: ['alfa', 'beta'], complete: true, unmatched: [], rows, ...extra });
const match = (round, status = 'played', date = `2026-09-${String(round * 3).padStart(2, '0')}`) =>
  ({ round, homeId: 'alfa', awayId: 'beta', status, date });

test('Fantasy scoring handles separate goals, penalties and red cards; clean sheet is for goalkeepers', () => {
  const line = row(player, 6, true, { goals: 1, penaltyScored: 1, ownGoal: 1, redCard: 1, assist: 1, yellowCard: 1,
    goalsConceded: 2, penaltySaved: 1, penaltyMissed: 1 });
  assert.equal(officialFantasyScore(line, edition), 6.5);
  assert.equal(officialFantasyScore(line, 'Statistico', { goal: 4, cleanSheet: 2 }), 8);
  assert.equal(officialFantasyScore(row(keeper, 6, false, { penaltySaved: 1 }), edition, { cleanSheet: 1 }), 10);
  assert.equal(officialFantasyScore(row(keeper, 6, false, { goalsConceded: 2 }), edition, { cleanSheet: 1 }), 4);
  assert.equal(officialFantasyScore(row(keeper, 6, false, { goalsConceded: null }), edition), null);
});

test('An observed team distinguishes no vote, missing group, ambiguous match, and historical transfer', () => {
  const oldPlayer = { ...player, teamId: 'beta' };
  const sameClubPlayer = { ...player, id: 'invent-due' };
  const archive = buildOfficialVoteIndex([
    day(1, [], { teamIds: ['beta'] }),
    day(2, [], { unmatched: [{ teamId: 'alfa', position: 'FWD', candidateIds: [player.id] }] }),
    day(3, [], { unmatched: [{ teamId: 'alfa', position: 'FWD', candidateIds: [] }] }),
    day(4, [row(oldPlayer, 6)]),
    day(5, []),
    day(6, [row(player, 7), row(sameClubPlayer, 6.5)]),
    day(7, [], { unmatched: [{ teamId: 'alfa', position: 'DEF', candidateIds: [] }] }),
    day(8, [row(player, 6)], { complete: false }),
  ]);
  assert.equal(archive.record(player, season, 1), undefined);
  assert.equal(archive.record(player, season, 2), undefined);
  assert.equal(archive.record(player, season, 3), undefined);
  assert.equal(archive.record(player, season, 4).teamId, 'beta');
  assert.equal(archive.record(player, season, 5), undefined);
  assert.equal(archive.record(player, season, 6).fantasyRating, 7);
  assert.equal(archive.record(player, season, 7), undefined);
  assert.equal(archive.record(sameClubPlayer, season, 5), undefined);
  assert.equal(archive.record(sameClubPlayer, season, 7).fantasyRating, null);
  assert.equal(archive.record(player, season, 8).fantasyRating, 6);
  assert.equal(archive.record(sameClubPlayer, season, 8), undefined);
  const sameSeasonTransfer = buildOfficialVoteIndex([day(4, [row(oldPlayer, 6)]), day(5, [])]);
  assert.equal(sameSeasonTransfer.record(player, season, 5), undefined);
});

test('Pre-match projection uses only played games, valid observation denominators, shrunk rates and unstarred SD', () => {
  const fixture = match(6, 'scheduled');
  const baseline = Array.from({ length: 24 }, (_, i) =>
    row({ ...player, id: `invent-${i}` }, i < 4 ? 9 : i % 2 ? 6 : 7, i < 4));
  const archive = buildOfficialVoteIndex([
    day(1, [row(player, 6, true, { goals: 1 }), ...baseline]),
    day(2, [row(player, 7, false, { penaltyMissed: 1 })]),
    day(3, []),
    day(4, [row(player, 9, false, { goals: 5 })]),
    day(5, [], { teamIds: ['beta'] }),
    day(6, [row(player, 9, false, { goals: 2 })])
  ]);
  const projection = archive.project(player, { season, fixture, fixtures: [match(1), match(2), match(3),
    match(4, 'played', '2026-09-23'), match(5), fixture], asOf: '2026-09-17T10:00:00Z' });
  assert.equal(projection.method, 'official-history');
  assert.deepEqual(projection.sample.rounds, [1, 2, 3]);
  assert.equal(projection.voteProbability, 2 / 3);
  assert.equal(projection.sample.averageRating, 6.5);
  assert.equal(projection.sample.ratingCount, 21);
  assert.equal(projection.sample.sdFallback, false);
  assert.ok(projection.sample.ratingSd <= 0.55);
  assert.ok(projection.sample.eventRates.goals > 0 && projection.sample.eventRates.goals < 0.5);
  assert.equal(projection.sample.rigoristaCandidate, true);
});

test('Synthetic official draws preserve base vote and approximate the analytical conditional mean', () => {
  const fixture = match(4, 'scheduled');
  const archive = buildOfficialVoteIndex([day(1, [row(keeper, 6, false, { penaltySaved: 1 })]),
    day(2, [row(keeper, 7, true, { goalsConceded: 2 })]), day(3, [])], { scoring: { cleanSheet: 1 } });
  const projection = archive.project(keeper, { season, fixture, fixtures: [match(1), match(2), match(3), fixture],
    asOf: '2026-09-11T00:00:00Z' });
  assert.equal(projection.sample.sdFallback, true);
  assert.equal(projection.sample.ratingSd, 0.45);
  let seed = 42;
  const rng = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  let points = 0;
  for (let trial = 0; trial < 18000; trial++) {
    const score = drawOfficialFantasy(projection, rng);
    assert.ok(score.vote >= 0 && score.vote <= 10);
    points += score.points;
  }
  assert.ok(Math.abs(points / 18000 - projection.scores[0]) < 0.05);
});

function validationData(change = true) {
  const players = Array.from({ length: 60 }, (_, index) => ({ ...player, id: `learning-${index}`, teamId: index < 30 ? 'alfa' : 'beta' }));
  const fixtures = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8, 1 + index * 3)).toISOString().slice(0,10);
    return match(index + 1, index === 11 ? 'scheduled' : 'played', date);
  });
  const days = fixtures.slice(0,-1).map(({ round }) => day(round, players
    .filter((person,index) => !change || round <= 3 || index % 2 === 0).map(person => row(person, 6))));
  return { players, days, fixtures };
}

test('Walk-forward validation selects recent form after enough evidence and tracks the replay separately', () => {
  const { players, days, fixtures } = validationData();
  const archive = buildOfficialVoteIndex(days);
  const report = archive.validation({ season, fixtures, asOf: '2026-10-05' });
  assert.equal(report.rounds, 8);
  assert.equal(report.samples, 480);
  assert.equal(report.model, 'adaptive');
  assert.equal(report.adaptiveRounds, 4);
  assert.ok(report.adaptive.brier < report.history.brier);
  assert.ok(report.adaptive.mae < report.history.mae);
  const earlier = archive.validation({ season, fixtures, asOf: '2026-09-16' });
  assert.equal(earlier.model, 'history');
  const forecast = archive.project(players[1], { season, fixtures, fixture: fixtures.at(-1), asOf: '2026-10-03' });
  assert.equal(forecast.sample.calibrationModel, 'adaptive');
  assert.ok(forecast.voteProbability < 3 / 11);
});

test('Future vote files, final results on the same day and later transfers cannot alter an earlier estimate', () => {
  const { players, days, fixtures } = validationData();
  const subject = players[1];
  const fixture = fixtures[7];
  const target = { season, fixture, fixtures, asOf: fixture.date };
  const earlier = buildOfficialVoteIndex(days.slice(0,7));
  const all = buildOfficialVoteIndex([...days.slice(0,9),
    day(10, [...days[9].rows, row({ ...subject, teamId: 'beta' }, 9)]), days[10]]);
  const first = earlier.project(subject, target);
  assert.deepEqual(all.project(subject, target), first);
  assert.equal(first.sample.asOfRound, 7);
  assert.equal(all.validation({ ...target, beforeRound: 8 }).rounds, 4);
  const sameDay = fixtures.map(game => game.round === 7 ? { ...game, date:fixture.date } : game);
  const earlierCutoff = all.project(subject, { ...target, fixtures:sameDay });
  assert.equal(earlierCutoff.sample.asOfRound, 6);
  assert.equal(earlierCutoff.sample.calibrationModel, 'history');
});

test('A perfect stable history keeps the simpler candidate after validation', () => {
  const { days, fixtures } = validationData(false);
  const report = buildOfficialVoteIndex(days).validation({ season, fixtures, asOf: '2026-10-05' });
  assert.equal(report.rounds, 8);
  assert.equal(report.history.brier, 0);
  assert.equal(report.model, 'history');
});
