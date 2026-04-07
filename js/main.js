// Main - entry point that wires everything together

import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { Game } from './game.js';

function init() {
  const canvas = document.getElementById('game');
  if (!canvas) {
    console.error('Canvas element #game not found');
    return;
  }

  const renderer = new Renderer(canvas);
  const input = new Input(canvas);
  const game = new Game(renderer, input);

  game.start();

  // Expose for debugging
  window.__game = game;
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
