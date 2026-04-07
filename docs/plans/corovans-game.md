# КОРОВАНЫ - Browser Caravan Robbery Game

## Overview

A top-down 2D action game built with HTML5 Canvas and vanilla JavaScript where the player is a bandit who ambushes and robs caravans traveling along desert roads. The game features wave-based progression, combat, loot, and an upgrade shop between waves.

Inspired by the classic Russian internet meme "грабить корованы" - this is the game that kid always wanted.

## Context

- Tech: Pure HTML5 Canvas + vanilla JavaScript (ES modules, no build tools, no npm)
- Style: Pixel art rendered procedurally on canvas (no external image assets)
- Sound: Generated with Web Audio API (no audio files needed)
- Target: Modern browsers, desktop (keyboard + mouse)
- All game logic should be testable with Node.js

## Architecture

```
index.html              - Entry point
style.css               - Minimal styling
js/
  main.js               - Bootstrap, game init
  game.js               - Game class, main loop, state machine
  input.js              - Keyboard/mouse input
  renderer.js           - Canvas rendering utilities
  camera.js             - Camera following player
  world.js              - Desert map + road generation
  player.js             - Player character
  caravan.js            - Caravan + guard entities
  combat.js             - Combat mechanics
  loot.js               - Loot drops and collection
  particles.js          - Particle effects
  ui.js                 - HUD, menus, shop
  audio.js              - Web Audio API sound generation
  utils.js              - Vector math, helpers, constants
tests/
  test-utils.js         - Test runner
  test-combat.js        - Combat logic tests
  test-collision.js     - Collision tests
  test-vector.js        - Vector math tests
```

## Validation

- Tests: `node tests/test-vector.js && node tests/test-player.js && node tests/test-caravan.js && node tests/test-combat.js && node tests/test-ui.js && node tests/test-collision.js`
- Lint: `echo "no lint configured"` (vanilla JS, no tooling)
- Manual: open index.html in browser

---

### Task 1: Project Foundation - Game Loop, Rendering, and World

Set up the core engine: HTML structure, game loop with fixed timestep, canvas rendering utilities, input handling, camera system, and desert world with roads.

- [x] Create index.html with canvas element and style.css
- [x] Implement utils.js with Vec2 class, math helpers, and game constants
- [x] Implement input.js for keyboard and mouse state tracking
- [x] Implement renderer.js with canvas drawing utilities (rect, circle, sprite, text)
- [x] Implement camera.js with position, follow target, and screen/world coordinate conversion
- [x] Implement world.js with desert terrain rendering and road generation
- [x] Implement game.js with Game class, fixed-timestep loop, and game state machine (menu/playing/shop/gameover)
- [x] Create main.js entry point that wires everything together
- [x] Write tests for Vec2 and collision utilities in tests/test-vector.js

### Task 2: Player Character and Movement

Create the player entity with movement, rendering, and animation.

- [x] Implement player.js with Player class (position, velocity, health, gold, stats)
- [x] Add WASD/arrow key movement with acceleration and friction
- [x] Draw player character as a procedural pixel-art bandit sprite
- [x] Add idle and walking animation states
- [x] Integrate player with camera (camera follows player)
- [x] Add map boundary collision to keep player in world
- [x] Wire player into game loop (update + render)

### Task 3: Caravans, Guards, and Spawning

Create caravan entities with guards that travel along roads, and a wave-based spawning system.

- [x] Implement caravan.js with Caravan class (type, speed, loot value, guard slots)
- [x] Add three caravan types: donkey (small/fast), wagon (medium), royal carriage (slow/rich)
- [x] Implement guard entities attached to caravans (health, damage, detection radius)
- [x] Add guard AI: patrol near caravan, chase player when in detection range, return when too far
- [x] Implement caravan path-following along roads
- [x] Create wave-based spawning system (wave number determines caravan count and types)
- [x] Draw procedural sprites for caravans and guards
- [x] Wire into game loop

### Task 4: Combat and Loot System

Implement melee combat, health, damage, loot drops, and collection.

- [x] Add attack action (Space key or click) with cooldown and attack range
- [x] Implement hit detection between player attack and enemies
- [x] Add health system with damage calculation (player.damage vs guard.armor)
- [x] Show floating damage numbers on hit
- [x] Implement guard death and loot dropping from defeated caravans
- [x] Create loot.js with gold coin entities that can be picked up by walking over them
- [x] Add player death and game over trigger when HP reaches 0
- [x] Implement attack animation for player
- [x] Write tests for combat calculations in tests/test-combat.js

### Task 5: UI - HUD, Menus, and Shop

Create all user interface elements: in-game HUD, main menu, game over screen, and upgrade shop.

- [x] Implement ui.js with UI class managing all screens
- [x] Create main menu screen with title "КОРОВАНЫ", start button, and brief instructions
- [x] Add in-game HUD: health bar, gold counter, wave number, enemy count
- [x] Create game over screen showing stats (waves survived, gold earned, caravans robbed)
- [x] Implement between-wave shop screen with upgrade options
- [x] Add upgrades: increase damage, increase max HP, increase speed, increase attack range
- [x] Implement shop purchasing logic (spend gold, apply stat changes)
- [x] Add wave transition: all caravans cleared -> show shop -> start next wave

### Task 6: Progression, Difficulty, and Enemy Variety

Implement difficulty scaling, enemy variety, and boss waves.

- [ ] Scale wave difficulty: more caravans, more guards per caravan per wave
- [ ] Add guard types: basic (sword), armored (high HP), archer (ranged attack)
- [ ] Implement archer guard ranged attack (projectile entity)
- [ ] Add boss caravan every 5 waves (extra large, many guards, huge loot)
- [ ] Implement scoring system (gold earned + bonus for flawless waves)
- [ ] Balance difficulty curve (playtest-friendly constants in utils.js)
- [ ] Write tests for collision detection in tests/test-collision.js

### Task 7: Polish - Particles, Sound, and Visual Juice

Add all the polish that makes the game feel satisfying.

- [ ] Implement particles.js with particle system (emitters, gravity, fade)
- [ ] Add dust particles when player/entities move
- [ ] Add hit particles (sparks on attack, gold sparkle on loot pickup)
- [ ] Add screen shake on dealing/receiving damage
- [ ] Implement audio.js with Web Audio API sound generation
- [ ] Add sound effects: attack swoosh, hit impact, coin pickup, guard death, player hurt
- [ ] Add ambient desert wind background sound
- [ ] Add entity flash-white on taking damage
- [ ] Add squash/stretch animation on attacks and landings
- [ ] Final visual pass: make the title screen look impressive
