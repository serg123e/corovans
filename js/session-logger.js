// SessionLogger - records every game session for later balance analysis.
//
// Each session is a JSON object containing:
//   - id:         unique string
//   - commit:     current build commit (from version.json, or 'unknown')
//   - startedAt:  ISO timestamp
//   - endedAt:    ISO timestamp (set on endSession)
//   - events:     chronological list of lightweight event records
//   - summary:    aggregated counters updated by hooks during play
//
// Storage: localStorage under STORAGE_KEY, up to MAX_SESSIONS kept
// (oldest trimmed). Safe in Node (tests) and in browsers without storage
// thanks to the _readStore / _writeStore wrappers.
//
// Events are tiny on purpose — logging a full combat state every frame
// would blow out storage. We only log state transitions and terminal
// events (kills, picks, damage, death). Running counters in `summary`
// give us aggregated metrics without storing per-tick detail.

const STORAGE_KEY = 'korovany.sessions';
const MAX_SESSIONS = 100;

function nowIso() {
  return new Date().toISOString();
}

function genId() {
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `${Date.now().toString(36)}-${rand}`;
}

function safeRead() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function safeWrite(sessions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadAllSessions() {
  return safeRead();
}

export function clearAllSessions() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (e) {
    return false;
  }
}

// Count persisted sessions without parsing them all (approximate fallback
// to full parse if needed). Used by the main menu.
export function countSessions() {
  return safeRead().length;
}

export class SessionLogger {
  constructor(options = {}) {
    this.commit = options.commit || 'unknown';
    this.session = null;
    this._startMs = 0;
    // Optional logical clock for deterministic sims. When set, replaces
    // Date.now() for event timestamps + durationMs. Live game leaves it
    // null and gets wall-clock behavior.
    this._clock = typeof options.clock === 'function' ? options.clock : null;
  }

  _nowMs() {
    return this._clock ? this._clock() : Date.now();
  }

  setCommit(commit) {
    this.commit = commit || 'unknown';
  }

  // Begin a new session. Discards any in-progress session without persisting
  // it — intended for fresh runs from the main menu. Pass `meta.id` to
  // force a specific session id (used by the simulator for reproducibility).
  startSession(meta = {}) {
    this._startMs = this._nowMs();
    const { id: forcedId, ...metaRest } = meta;
    this.session = {
      id: forcedId || genId(),
      commit: this.commit,
      startedAt: nowIso(),
      endedAt: null,
      meta: { ...metaRest },
      events: [],
      summary: {
        waveReached: 0,
        wavesCompleted: 0,
        guardsKilled: 0,
        guardsKilledByType: { basic: 0, armored: 0, archer: 0 },
        guardsKilledBySource: { melee: 0, thorns: 0 },
        caravansRobbed: 0,
        caravansRobbedByType: { donkey: 0, wagon: 0, royal: 0 },
        bossesDefeated: 0,
        damageDealt: 0,
        damageReflected: 0,
        damageTaken: 0,
        goldEarned: 0,
        goldSpent: 0,
        dashesUsed: 0,
        attacks: 0,
        rerolls: 0,
        cardsPicked: [],
        flawlessWaves: 0,
        died: false,
        finalScore: 0,
        durationMs: 0,
      },
    };
    this._log('session_start', metaRest);
  }

  _log(type, data = {}) {
    if (!this.session) return;
    const t = this._nowMs() - this._startMs;
    this.session.events.push({ t, type, ...data });
  }

  // --- Event hooks (called from game.js) -------------------------------
  //
  // Each hook updates the summary counters and appends a lightweight event
  // record. Keep these small — fields are flat so a CSV dump is trivial.

  logWaveStart(wave, info = {}) {
    if (!this.session) return;
    this.session.summary.waveReached = Math.max(this.session.summary.waveReached, wave);
    this._log('wave_start', { wave, ...info });
  }

  logWaveEnd(wave, info = {}) {
    if (!this.session) return;
    this.session.summary.wavesCompleted = Math.max(this.session.summary.wavesCompleted, wave);
    this._log('wave_end', { wave, ...info });
  }

  logGuardKilled(type, wave, source = 'melee') {
    if (!this.session) return;
    this.session.summary.guardsKilled++;
    const byType = this.session.summary.guardsKilledByType;
    if (byType[type] !== undefined) byType[type]++;
    const bySource = this.session.summary.guardsKilledBySource;
    if (bySource[source] !== undefined) bySource[source]++;
    // Use `guardType` rather than `type` so the spread inside _log doesn't
    // clobber the event's own `type: 'guard_killed'` field.
    this._log('guard_killed', { guardType: type, wave, source });
  }

  logDamageReflected(amount) {
    if (!this.session) return;
    this.session.summary.damageReflected += amount;
  }

  logCaravanRobbed(type, value, wave, isBoss = false) {
    if (!this.session) return;
    this.session.summary.caravansRobbed++;
    const byType = this.session.summary.caravansRobbedByType;
    if (byType[type] !== undefined) byType[type]++;
    if (isBoss) this.session.summary.bossesDefeated++;
    // Rename `type` → `caravanType` for the same reason as logGuardKilled.
    this._log('caravan_robbed', { caravanType: type, value, wave, boss: isBoss });
  }

  logDamageDealt(amount, wave) {
    if (!this.session) return;
    this.session.summary.damageDealt += amount;
    // Not stored as a per-hit event — too noisy. Only summary.
  }

  logPlayerDamaged(amount, source, wave, hpAfter) {
    if (!this.session) return;
    this.session.summary.damageTaken += amount;
    this._log('player_damaged', { amount, source, wave, hpAfter });
  }

  logGoldEarned(amount) {
    if (!this.session) return;
    this.session.summary.goldEarned += amount;
  }

  logGoldSpent(amount) {
    if (!this.session) return;
    this.session.summary.goldSpent += amount;
  }

  logAttack(wave) {
    if (!this.session) return;
    this.session.summary.attacks++;
  }

  logDash(wave) {
    if (!this.session) return;
    this.session.summary.dashesUsed++;
    this._log('dash', { wave });
  }

  logCardPicked(cardId, rarity, mode, cost, wave) {
    if (!this.session) return;
    this.session.summary.cardsPicked.push({ id: cardId, rarity, mode, cost, wave });
    this._log('card_picked', { id: cardId, rarity, mode, cost, wave });
  }

  logReroll(mode, cost, wave) {
    if (!this.session) return;
    this.session.summary.rerolls++;
    this._log('reroll', { mode, cost, wave });
  }

  logShopOpened(origin, wave) {
    if (!this.session) return;
    this._log('shop_opened', { origin, wave });
  }

  logShopClosed(origin, wave) {
    if (!this.session) return;
    this._log('shop_closed', { origin, wave });
  }

  logFlawless(wave, bonus) {
    if (!this.session) return;
    this.session.summary.flawlessWaves++;
    this._log('flawless', { wave, bonus });
  }

  logDeath(wave, finalScore) {
    if (!this.session) return;
    this.session.summary.died = true;
    this.session.summary.finalScore = finalScore;
    this._log('player_died', { wave, finalScore });
  }

  // Finalize the current session and persist it to localStorage.
  // `extras` lets the caller merge terminal state (final score, etc.)
  // into the summary.
  endSession(extras = {}) {
    if (!this.session) return null;
    this.session.endedAt = nowIso();
    this.session.summary.durationMs = this._nowMs() - this._startMs;
    Object.assign(this.session.summary, extras);

    const finished = this.session;
    this.session = null;

    const sessions = safeRead();
    sessions.push(finished);
    while (sessions.length > MAX_SESSIONS) sessions.shift();
    safeWrite(sessions);

    return finished;
  }

  // Current session snapshot (read-only helper for the HUD / debugging).
  getCurrent() {
    return this.session;
  }

  // --- Export / import ------------------------------------------------

  // Build a downloadable JSON string of all sessions. Pure function —
  // caller is responsible for triggering the browser download.
  buildExportJson() {
    const sessions = safeRead();
    return JSON.stringify(
      {
        exportedAt: nowIso(),
        count: sessions.length,
        sessions,
      },
      null,
      2
    );
  }

  // Trigger a browser download of the exported JSON. No-op in headless
  // environments (tests) where `document` / `Blob` / `URL` are missing.
  downloadExport() {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') return false;
    const json = this.buildExportJson();
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `korovany-sessions-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (e) {
      return false;
    }
  }
}
