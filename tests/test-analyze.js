// Tests for js/sim/analyze.js helper functions.

import { median, splitPicks, paidCohorts, percentiles, deathCauses } from '../js/sim/analyze.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

// --- median ---

assert(median([]) === 0, 'median: empty → 0');
assert(median([5]) === 5, 'median: single element');
assert(median([1, 2, 3]) === 2, 'median: odd-length');
assert(median([1, 2, 3, 4, 5]) === 3, 'median: odd 5 elements');
assert(median([3, 1, 2]) === 2, 'median: unsorted input');
assert(median([1, 2, 3, 4]) === 3, 'median: even-length → upper-middle');
assert(median([10, 10, 10]) === 10, 'median: all equal');

// --- splitPicks ---

function makeSession(picks) {
  return { summary: { cardsPicked: picks } };
}

{
  const sp = splitPicks(makeSession([]));
  assert(sp.free === 0, 'splitPicks: empty → free=0');
  assert(sp.paid === 0, 'splitPicks: empty → paid=0');
}

{
  const sp = splitPicks(makeSession([
    { id: 'damage', mode: 'free' },
    { id: 'regen', mode: 'free' },
    { id: 'speed', mode: 'paid' },
  ]));
  assert(sp.free === 2, 'splitPicks: 2 free');
  assert(sp.paid === 1, 'splitPicks: 1 paid');
}

{
  // Missing mode field → counted as free.
  const sp = splitPicks(makeSession([
    { id: 'damage' },
    { id: 'regen' },
  ]));
  assert(sp.free === 2, 'splitPicks: missing mode → free');
  assert(sp.paid === 0, 'splitPicks: missing mode → 0 paid');
}

{
  const sp = splitPicks({ summary: null });
  assert(sp.free === 0, 'splitPicks: null summary → free=0');
  assert(sp.paid === 0, 'splitPicks: null summary → paid=0');
}

// --- paidCohorts ---

function makeSessionWithPaid(paidCount) {
  const picks = [];
  for (let i = 0; i < 3; i++) picks.push({ id: 'damage', mode: 'free' });
  for (let i = 0; i < paidCount; i++) picks.push({ id: 'speed', mode: 'paid' });
  return { summary: { cardsPicked: picks, waveReached: 4 + paidCount, durationMs: 60000, goldSpent: paidCount * 15 } };
}

{
  const sessions = [
    makeSessionWithPaid(0),
    makeSessionWithPaid(0),
    makeSessionWithPaid(1),
    makeSessionWithPaid(3),
    makeSessionWithPaid(7),
  ];
  const c = paidCohorts(sessions);
  assert(c['paid=0'].length === 2, 'cohorts: paid=0 bucket');
  assert(c['paid=1-2'].length === 1, 'cohorts: paid=1-2 bucket');
  assert(c['paid=3-5'].length === 1, 'cohorts: paid=3-5 bucket');
  assert(c['paid≥6'].length === 1, 'cohorts: paid≥6 bucket');
}

{
  // Every session ends up in exactly one bucket.
  const sessions = [makeSessionWithPaid(2)];
  const c = paidCohorts(sessions);
  const total = Object.values(c).reduce((a, b) => a + b.length, 0);
  assert(total === 1, 'cohorts: session in exactly one bucket');
  assert(c['paid=1-2'].length === 1, 'cohorts: paid=2 goes to 1-2 bucket');
  assert(c['paid=0'].length === 0, 'cohorts: paid=2 not in paid=0');
}

// --- percentiles ---

{
  const p = percentiles([]);
  assert(p === null, 'percentiles: empty → null');
}

{
  const p = percentiles([10, 20, 30, 40, 50]);
  assert(p.min === 10, 'percentiles: min');
  assert(p.max === 50, 'percentiles: max');
  assert(p.p50 === 30, 'percentiles: p50');
  assert(p.p25 === 20, 'percentiles: p25');
}

{
  const p = percentiles([5]);
  assert(p.min === 5, 'percentiles: single min');
  assert(p.max === 5, 'percentiles: single max');
  assert(p.p50 === 5, 'percentiles: single p50');
}

// --- deathCauses ---

{
  const sessions = [
    {
      summary: { died: true },
      events: [
        { type: 'player_damaged', source: 'guard:armored', amount: 12 },
        { type: 'player_damaged', source: 'arrow', amount: 6 },
        { type: 'player_died' },
      ],
    },
    {
      summary: { died: true },
      events: [
        { type: 'player_damaged', source: 'guard:basic', amount: 8 },
        { type: 'player_died' },
      ],
    },
    {
      summary: { died: false },
      events: [
        { type: 'player_damaged', source: 'guard:basic', amount: 8 },
      ],
    },
  ];
  const dc = deathCauses(sessions);
  assert(dc['arrow'] === 1, 'deathCauses: arrow killed 1 (last dmg before death)');
  assert(dc['guard:basic'] === 1, 'deathCauses: basic killed 1');
  assert(dc['guard:armored'] === undefined, 'deathCauses: armored was not the killing blow');
  assert(Object.keys(dc).length === 2, 'deathCauses: only 2 death sources (alive run excluded)');
}

{
  // Edge case: died=true but no player_damaged events → killer is 'unknown'.
  const dc = deathCauses([{
    summary: { died: true },
    events: [{ type: 'player_died' }],
  }]);
  assert(dc['unknown'] === 1, 'deathCauses: no damage events → unknown');
}

console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
