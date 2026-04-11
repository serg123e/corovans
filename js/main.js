// Main - entry point that wires everything together

import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { Game } from './game.js';

// Fetch the build tag so session logs can attribute balance problems to a
// specific commit. Swallows failures — if version.json is missing or the
// file:// origin blocks fetch, we fall back to 'unknown' without crashing.
async function loadBuildInfo() {
  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    if (!res.ok) return { commit: 'unknown', short: 'unknown' };
    const data = await res.json();
    return {
      commit: data.commit || 'unknown',
      short: data.short || (data.commit ? data.commit.slice(0, 7) : 'unknown'),
    };
  } catch (e) {
    return { commit: 'unknown', short: 'unknown' };
  }
}

async function init() {
  const canvas = document.getElementById('game');
  if (!canvas) {
    console.error('Canvas element #game not found');
    return;
  }

  const build = await loadBuildInfo();

  const renderer = new Renderer(canvas);
  const input = new Input(canvas);
  const game = new Game(renderer, input, { build });

  game.start();

  // Expose for debugging / manual log export from devtools.
  window.__game = game;
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
