# КОРОВАНЫ

Browser-based caravan robbery game. HTML5 Canvas + vanilla JS, no build tools.

## Project Structure

```
index.html          - Entry point, loads js/main.js as ES module
style.css           - Minimal full-screen canvas styling
js/
  main.js           - Bootstrap, creates Renderer/Input/Game
  game.js           - Game class, fixed-timestep loop, state machine (menu/playing/paused/shop/gameover)
  input.js          - Keyboard/mouse/touch input tracking
  renderer.js       - Canvas drawing utilities (rect, circle, text, etc.)
  camera.js         - Camera with follow, shake, world-to-screen conversion
  world.js          - Desert terrain + road generation (cached to offscreen canvas)
  player.js         - Player entity (movement, stats, attack animation, card modifiers)
  caravan.js        - Caravan + Guard entities, wave spawning, guard AI, path following
  combat.js         - Attack hit detection, damage calculation, Projectile class
  loot.js           - Gold coin drops and magnetic collection
  particles.js      - Particle system (dust, sparks, gold sparkle, death burst)
  ui.js             - HUD, main menu, draft card shop (free + paid modes), pause, game over
  shop.js           - In-world Shop building the player approaches with E to buy cards
  audio.js          - Web Audio API sound generation (no audio files), mute toggle
  storage.js        - localStorage wrapper: best score/wave, mute preference
  session-logger.js - Per-session telemetry (events + summary) persisted to localStorage + auto-POST to telemetry server
  rng.js            - Seeded xorshift32 PRNG; used by the simulator for reproducible runs
  sim/
    sim-input.js      - Fake Input for headless sims (getMovement only)
    policies.js       - AIPolicy base + GreedyPolicy / SmartPolicy / RandomCardPolicy / PreferencePolicy / RunnerPolicy
    simulator.js      - Headless Simulator: runs full sessions with an AIPolicy, no render/audio
    run.js            - Node CLI runner: batches of sims with aggregate summary + JSON export
  utils.js          - Vec2 class, collision helpers, math utilities, game constants (CONST)
tests/
  test-vector.js         - Vec2 and collision utility tests
  test-player.js         - Player movement and stats tests
  test-caravan.js        - Caravan, guard, and wave spawning tests
  test-combat.js         - Combat calculation tests
  test-ui.js             - UI logic tests
  test-collision.js      - Collision detection tests
  test-particles.js      - Particle system tests
  test-input.js          - Input handling tests (touch, keyboard override, tap vs. drag)
  test-session-logger.js - SessionLogger event hooks, persistence, export
  test-simulator.js      - Simulator + policies: SimInput, GreedyPolicy, runBatch, summarize
scripts/
  update-version.sh      - Regenerate version.json with current git HEAD; run before playtests
  telemetry-server.js    - Node stdlib HTTP sink for session uploads (POST /sessions → telemetry/sessions/<id>.json)
telemetry/
  sessions/              - Uploaded session JSONs (gitignored; one file per session id)
version.json        - Build tag (commit sha) loaded at boot by main.js; embedded in logs
```

## Commands

Common operations live in the `Makefile` — `make help` lists them. Shortcuts: `make test`, `make sim`, `make combo`, `make telemetry`, `make ngrok`, `make version`, `make play`. The raw commands below are the source of truth for the targets.

- Run all tests: `node tests/test-vector.js && node tests/test-player.js && node tests/test-caravan.js && node tests/test-combat.js && node tests/test-ui.js && node tests/test-collision.js && node tests/test-particles.js && node tests/test-input.js && node tests/test-session-logger.js && node tests/test-simulator.js`
- Play: open `index.html` in browser (no server needed, uses ES modules)
- Update build tag before playtesting: `./scripts/update-version.sh` (or symlink to `.git/hooks/post-commit`)
- Run headless AI batches: `node js/sim/run.js --policy greedy --count 50 --max-waves 20 [--seed 42] [--start-cards id,id] [--out sim.json]`
  - Output includes per-wave mortality curve. Add `--seed N` for reproducible runs (same seed ⇒ byte-identical JSON except `startedAt`/`endedAt`/`exportedAt`).
  - A/B compare: `node js/sim/run.js --policy preference --prefer thorns --compare "preference --avoid thorns"` runs a second batch and prints the delta. When `--seed` is set, the alt arm's seed is offset so the two batches aren't traversing identical random sequences.
  - Policies: `greedy` (baseline, median wave ~4, dies fast), `smart` (baseline for late-game analysis, median wave ~11: arrow dodging, swarm retreat, threat-weighted targeting), `preference` (forced card build), `random-cards`, `runner`.
  - Combo scan: `node js/sim/run.js --policy smart --combo-scan --count 20 --max-waves 20 [--combo-stack 3] [--combo-cards id,id] [--combo-top 15] [--out combo.json]` runs every unordered card pair with pre-baked stacks and prints Δwave vs baseline. At count=20/pair, default 12-card sweep = 1340 sims ≈ 4 minutes on smart.
- Start telemetry sink: `node scripts/telemetry-server.js` (port 12000, writes to `telemetry/sessions/`). Expose via `ngrok http --url=rapid-mayfly-intense.ngrok-free.app 12000` — the client in `js/session-logger.js` POSTs finished sessions to that URL automatically. Menu hotkey Shift+U backfills all cached localStorage sessions.
- No linter or formatter configured

## Conventions

- Pure vanilla JS with ES modules (import/export), no npm, no bundler
- All game constants live in `CONST` object in `js/utils.js`
- Vec2 operations return new Vec2 (immutable style)
- Entity pattern: classes with `update(dt, ...)` and `render(renderer)` methods
- Tests use inline assert helpers (no test framework, each file is self-contained)
- Procedural rendering only -- no image/sprite/audio assets
- Fixed-timestep game loop at 60 FPS with accumulator pattern
