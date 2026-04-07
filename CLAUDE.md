# КОРОВАНЫ

Browser-based caravan robbery game. HTML5 Canvas + vanilla JS, no build tools.

## Project Structure

```
index.html          - Entry point, loads js/main.js as ES module
style.css           - Minimal full-screen canvas styling
js/
  main.js           - Bootstrap, creates Renderer/Input/Game
  game.js           - Game class, fixed-timestep loop, state machine (menu/playing/shop/gameover)
  input.js          - Keyboard/mouse input tracking
  renderer.js       - Canvas drawing utilities (rect, circle, text, etc.)
  camera.js         - Camera with follow, shake, world-to-screen conversion
  world.js          - Desert terrain + road generation (cached to offscreen canvas)
  player.js         - Player entity (movement, stats, attack animation)
  caravan.js        - Caravan + Guard entities, wave spawning, guard AI, path following
  combat.js         - Attack hit detection, damage calculation, Projectile class
  loot.js           - Gold coin drops and magnetic collection
  particles.js      - Particle system (dust, sparks, gold sparkle, death burst)
  ui.js             - HUD, main menu, shop screen, game over screen
  audio.js          - Web Audio API sound generation (no audio files)
  utils.js          - Vec2 class, collision helpers, math utilities, game constants (CONST)
tests/
  test-utils.js     - Minimal test runner (assert/run/report)
  test-vector.js    - Vec2 and collision utility tests
  test-player.js    - Player movement and stats tests
  test-caravan.js   - Caravan, guard, and wave spawning tests
  test-combat.js    - Combat calculation tests
  test-ui.js        - UI logic tests
  test-collision.js - Collision detection tests
  test-particles.js - Particle system tests
```

## Commands

- Run all tests: `node tests/test-vector.js && node tests/test-player.js && node tests/test-caravan.js && node tests/test-combat.js && node tests/test-ui.js && node tests/test-collision.js && node tests/test-particles.js`
- Play: open `index.html` in browser (no server needed, uses ES modules)
- No linter or formatter configured

## Conventions

- Pure vanilla JS with ES modules (import/export), no npm, no bundler
- All game constants live in `CONST` object in `js/utils.js`
- Vec2 operations return new Vec2 (immutable style)
- Entity pattern: classes with `update(dt, ...)` and `render(renderer)` methods
- Tests use a custom minimal runner in `tests/test-utils.js` (no test framework)
- Procedural rendering only -- no image/sprite/audio assets
- Fixed-timestep game loop at 60 FPS with accumulator pattern
