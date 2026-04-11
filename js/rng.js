// Seeded pseudo-random number generator.
//
// Used by the headless simulator so two runs with the same seed produce
// identical results (see sim/simulator.js). The live game keeps calling
// Math.random() directly — this module is wired only into code paths the
// sim touches (wave/guard rolls, draft card rolls, policy random picks).
//
// Algorithm: xorshift32. Period ~4.2B, sufficient for balance experiments
// where a single run uses at most ~1M rolls. NOT cryptographically secure.

// Pick a 0..1 number source: the seeded rng's `next` when present,
// Math.random otherwise. Saves repeating `rng ? rng.next : Math.random`
// at every call-site that wants an optional seed.
export function randFn(rng) {
  return rng ? rng.next : Math.random;
}

export function makeRng(seed) {
  let state = (seed | 0) ^ 0xdeadbeef;
  if (state === 0) state = 0x1a2b3c4d;

  function next() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  }

  function range(min, max) {
    return min + next() * (max - min);
  }

  function int(min, max) {
    return Math.floor(range(min, max + 1));
  }

  function choice(arr) {
    return arr[Math.floor(next() * arr.length)];
  }

  return { next, range, int, choice };
}
