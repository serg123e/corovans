# КОРОВАНЫ

A top-down 2D action game built with HTML5 Canvas and vanilla JavaScript.
You are a bandit ambushing and robbing caravans traveling along desert roads.

Inspired by the classic Russian internet meme "грабить корованы."

## How to Play

Open `index.html` in a modern desktop browser. No build tools, no npm, no server required.

### Controls

- **WASD / Arrow keys** -- Move
- **Space / Left click** -- Attack
- **Space / Enter** -- Advance through menus and shop

### Gameplay

- Defeat guards and destroy caravans to collect gold
- Between waves, spend gold on upgrades (damage, HP, speed, attack range)
- Boss caravans appear every 5 waves
- Clear waves without taking damage for a flawless bonus

### Enemy Types

- **Basic guard (sword)** -- melee, moderate HP
- **Armored guard** -- slow, high HP, high damage, damage reduction
- **Archer guard** -- ranged attacks, low HP

## Running Tests

```sh
node tests/test-vector.js && node tests/test-player.js && node tests/test-caravan.js && node tests/test-combat.js && node tests/test-ui.js && node tests/test-collision.js && node tests/test-particles.js
```

## Tech

- Pure HTML5 Canvas + vanilla JavaScript (ES modules)
- Procedural pixel-art rendering (no image assets)
- Sound via Web Audio API (no audio files)
- Desktop target (keyboard + mouse)
