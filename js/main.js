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

  // AI demo mode: open index.html?ai=smart (or greedy, runner, etc.)
  // to watch an AI policy play the game with full rendering.
  const params = new URLSearchParams(window.location.search);
  const aiPolicyName = params.get('ai');

  let input;
  let aiController = null;

  if (aiPolicyName) {
    const { POLICIES } = await import('./sim/policies.js');
    const { AIInput } = await import('./ai-input.js');
    const { AIController } = await import('./ai-controller.js');
    const factory = POLICIES[aiPolicyName];
    if (factory) {
      const policy = factory();
      input = new AIInput();
      aiController = new AIController(policy, input);
      console.log(`[ai] AI demo mode: policy=${aiPolicyName}`);
    } else {
      console.warn(`[ai] Unknown policy "${aiPolicyName}", falling back to human input`);
    }
  }

  if (!input) {
    input = new Input(canvas);
  }

  const game = new Game(renderer, input, { build });

  if (aiController) {
    game._aiController = aiController;
    // Speed control: 1-4 keys set game speed (1x, 2x, 4x, 8x).
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Digit1') game._timeScale = 1;
      else if (e.code === 'Digit2') game._timeScale = 2;
      else if (e.code === 'Digit3') game._timeScale = 4;
      else if (e.code === 'Digit4') game._timeScale = 8;
      else if (e.code === 'Digit5') game._timeScale = 16;
      else if (e.code === 'Digit6') game._timeScale = 32;
    });
  }

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
