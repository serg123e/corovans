// Tests for SessionLogger - event hooks, persistence, summary, export.
//
// Node doesn't ship a localStorage global, so we install a minimal
// in-memory stub on globalThis before any logger method that touches
// storage runs. The module references `localStorage` lazily inside
// try/catch wrappers, so ES module import-time is safe either way.

globalThis.localStorage = {
  _store: {},
  getItem(key) { return this._store[key] ?? null; },
  setItem(key, value) { this._store[key] = String(value); },
  removeItem(key) { delete this._store[key]; },
  clear() { this._store = {}; },
};

import { SessionLogger, loadAllSessions, clearAllSessions, countSessions } from '../js/session-logger.js';

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL: ${msg}`); }
}

function resetStorage() {
  globalThis.localStorage._store = {};
}

// --- Basic construction ---
{
  resetStorage();
  const l = new SessionLogger({ commit: 'abc123' });
  assert(l.commit === 'abc123', 'ctor: commit stored');
  assert(l.session === null, 'ctor: no session yet');
}

// --- startSession initializes the session object ---
{
  resetStorage();
  const l = new SessionLogger({ commit: 'abc123' });
  l.startSession({ note: 'test' });
  assert(l.session !== null, 'startSession: session created');
  assert(l.session.commit === 'abc123', 'startSession: commit tagged');
  assert(l.session.meta.note === 'test', 'startSession: meta preserved');
  assert(l.session.events.length === 1, 'startSession: emits session_start event');
  assert(l.session.events[0].type === 'session_start', 'startSession: first event is session_start');
  assert(l.session.summary.guardsKilled === 0, 'startSession: summary zeroed');
  assert(l.session.summary.died === false, 'startSession: died = false initially');
}

// --- logWaveStart updates waveReached ---
{
  resetStorage();
  const l = new SessionLogger();
  l.startSession();
  l.logWaveStart(1, { guards: 3 });
  l.logWaveStart(3, { guards: 5 });
  assert(l.session.summary.waveReached === 3, 'logWaveStart: waveReached tracks max');
}

// --- logGuardKilled increments total and per-type ---
{
  resetStorage();
  const l = new SessionLogger();
  l.startSession();
  l.logGuardKilled('basic', 1);
  l.logGuardKilled('armored', 2);
  l.logGuardKilled('armored', 2);
  l.logGuardKilled('archer', 3);
  assert(l.session.summary.guardsKilled === 4, 'guardsKilled total = 4');
  assert(l.session.summary.guardsKilledByType.basic === 1, 'basic count');
  assert(l.session.summary.guardsKilledByType.armored === 2, 'armored count');
  assert(l.session.summary.guardsKilledByType.archer === 1, 'archer count');
}

// --- logCaravanRobbed and boss flag ---
{
  resetStorage();
  const l = new SessionLogger();
  l.startSession();
  l.logCaravanRobbed('donkey', 20, 1, false);
  l.logCaravanRobbed('royal', 400, 5, true);
  assert(l.session.summary.caravansRobbed === 2, 'caravans total');
  assert(l.session.summary.caravansRobbedByType.donkey === 1, 'donkey count');
  assert(l.session.summary.caravansRobbedByType.royal === 1, 'royal count');
  assert(l.session.summary.bossesDefeated === 1, 'bossesDefeated tracked');
}

// --- logDamageDealt / logPlayerDamaged ---
{
  resetStorage();
  const l = new SessionLogger();
  l.startSession();
  l.logDamageDealt(15, 1);
  l.logDamageDealt(10, 1);
  l.logPlayerDamaged(8, 'guard:basic', 1, 92);
  l.logPlayerDamaged(6, 'arrow', 2, 86);
  assert(l.session.summary.damageDealt === 25, 'damageDealt sums');
  assert(l.session.summary.damageTaken === 14, 'damageTaken sums');
  // player_damaged events should be in the log
  const damageEvents = l.session.events.filter(e => e.type === 'player_damaged');
  assert(damageEvents.length === 2, 'player_damaged: 2 events recorded');
}

// --- logCardPicked records details ---
{
  resetStorage();
  const l = new SessionLogger();
  l.startSession();
  l.logCardPicked('damage', 'common', 'free', 0, 1);
  l.logCardPicked('lifesteal', 'uncommon', 'paid', 40, 3);
  assert(l.session.summary.cardsPicked.length === 2, 'cardsPicked has 2');
  assert(l.session.summary.cardsPicked[0].id === 'damage', 'first pick id');
  assert(l.session.summary.cardsPicked[1].mode === 'paid', 'second pick mode');
  assert(l.session.summary.cardsPicked[1].cost === 40, 'second pick cost');
}

// --- logReroll and logGoldSpent/Earned ---
{
  resetStorage();
  const l = new SessionLogger();
  l.startSession();
  l.logReroll('free', 10, 1);
  l.logReroll('free', 12, 1);
  l.logGoldEarned(100);
  l.logGoldSpent(40);
  assert(l.session.summary.rerolls === 2, 'rerolls count');
  assert(l.session.summary.goldEarned === 100, 'goldEarned');
  assert(l.session.summary.goldSpent === 40, 'goldSpent');
}

// --- logDash and logAttack ---
{
  resetStorage();
  const l = new SessionLogger();
  l.startSession();
  l.logDash(1); l.logDash(2);
  l.logAttack(1); l.logAttack(1); l.logAttack(2);
  assert(l.session.summary.dashesUsed === 2, 'dashes');
  assert(l.session.summary.attacks === 3, 'attacks');
}

// --- endSession persists to storage and clears current ---
{
  resetStorage();
  const l = new SessionLogger({ commit: 'deadbeef' });
  l.startSession();
  l.logWaveStart(1, {});
  l.logGuardKilled('basic', 1);
  l.logDeath(1, 42);
  const finished = l.endSession({ died: true, finalScore: 42 });
  assert(finished !== null, 'endSession returns the finished session');
  assert(finished.summary.finalScore === 42, 'finalScore copied');
  assert(finished.summary.died === true, 'died flag');
  assert(finished.endedAt !== null, 'endedAt timestamp set');
  assert(l.session === null, 'current session cleared after end');

  const saved = loadAllSessions();
  assert(saved.length === 1, 'persisted: one session');
  assert(saved[0].commit === 'deadbeef', 'persisted: commit tag');
}

// --- Multiple sessions accumulate and trim to max 100 ---
{
  resetStorage();
  const l = new SessionLogger();
  for (let i = 0; i < 110; i++) {
    l.startSession({ i });
    l.endSession({});
  }
  const saved = loadAllSessions();
  assert(saved.length === 100, 'ring buffer: trimmed to 100');
  // Newest should be i=109
  assert(saved[saved.length - 1].meta.i === 109, 'newest session at end');
  // Oldest retained should be i=10 (0..9 trimmed)
  assert(saved[0].meta.i === 10, 'oldest retained session correct');
}

// --- countSessions + clearAllSessions ---
{
  resetStorage();
  const l = new SessionLogger();
  l.startSession(); l.endSession();
  l.startSession(); l.endSession();
  assert(countSessions() === 2, 'countSessions: 2');
  clearAllSessions();
  assert(countSessions() === 0, 'clearAllSessions: 0 after clear');
}

// --- buildExportJson produces valid JSON with expected shape ---
{
  resetStorage();
  const l = new SessionLogger({ commit: 'zzz' });
  l.startSession();
  l.logGuardKilled('basic', 1);
  l.endSession({ finalScore: 10 });
  const json = l.buildExportJson();
  const parsed = JSON.parse(json);
  assert(parsed.count === 1, 'export: count field');
  assert(Array.isArray(parsed.sessions), 'export: sessions array');
  assert(parsed.sessions[0].summary.guardsKilled === 1, 'export: session data intact');
  assert(typeof parsed.exportedAt === 'string', 'export: timestamp included');
}

// --- downloadExport is a safe no-op in Node (no document) ---
{
  resetStorage();
  const l = new SessionLogger();
  const ok = l.downloadExport();
  assert(ok === false, 'downloadExport: returns false in headless env');
}

// --- Event hooks are no-ops when no session is active ---
{
  resetStorage();
  const l = new SessionLogger();
  // No startSession. These should not throw.
  l.logWaveStart(1, {});
  l.logGuardKilled('basic', 1);
  l.logDeath(1, 0);
  l.endSession();
  // Nothing should have been persisted.
  assert(countSessions() === 0, 'no session: hooks are no-ops');
}

console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
