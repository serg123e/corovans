// Storage - thin wrapper over localStorage with safe fallback
// Used for best score and user settings (mute).

const KEY_BEST_SCORE = 'korovany.bestScore';
const KEY_BEST_WAVE = 'korovany.bestWave';
const KEY_MUTED = 'korovany.muted';

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // storage unavailable (private mode, quota) — silently ignore
  }
}

export function getBestScore() {
  const v = safeGet(KEY_BEST_SCORE);
  const n = v === null ? 0 : parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function getBestWave() {
  const v = safeGet(KEY_BEST_WAVE);
  const n = v === null ? 0 : parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Record a finished run. Updates best score / best wave if surpassed.
// Returns true if either record was broken.
export function recordRun(score, wave) {
  let broken = false;
  if (score > getBestScore()) {
    safeSet(KEY_BEST_SCORE, String(score));
    broken = true;
  }
  if (wave > getBestWave()) {
    safeSet(KEY_BEST_WAVE, String(wave));
    broken = true;
  }
  return broken;
}

export function getMuted() {
  return safeGet(KEY_MUTED) === '1';
}

export function setMuted(muted) {
  safeSet(KEY_MUTED, muted ? '1' : '0');
}
