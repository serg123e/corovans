// Game - main game class with fixed-timestep loop and state machine

import { CONST } from './utils.js';
import { Camera } from './camera.js';
import { World } from './world.js';
import { Player } from './player.js';
import { spawnWave } from './caravan.js';
import { performAttack, Projectile } from './combat.js';
import { spawnLoot } from './loot.js';
import { UI } from './ui.js';
import { spawnDust, spawnHitSparks, spawnGoldSparkle, spawnDeathBurst, updateParticles, renderParticles } from './particles.js';
import { GameAudio } from './audio.js';

// Game states
export const State = {
  MENU: 'menu',
  PLAYING: 'playing',
  SHOP: 'shop',
  GAME_OVER: 'gameover',
};

export class Game {
  constructor(renderer, input) {
    this.renderer = renderer;
    this.input = input;
    this.camera = new Camera(renderer.width, renderer.height);
    this.world = new World();
    this.ui = new UI();

    this.audio = new GameAudio();
    this.state = State.MENU;
    this.wave = 0;
    this.score = 0;
    this.caravansRobbed = 0;
    this._dustTimer = 0;

    // Entity lists (populated by later tasks)
    this.player = null;
    this.caravans = [];
    this.guards = [];
    this.loots = [];
    this.particles = [];
    this.projectiles = [];
    this.floatingTexts = [];

    // Fixed timestep
    this._accumulator = 0;
    this._lastTime = 0;
    this._running = false;
    this._dt = 1 / 60; // 60 fps fixed step
    this._maxFrameTime = 0.1; // cap to avoid spiral of death

    // Resize handling
    this._onResize = () => {
      this.renderer.resize();
      this.camera.resize(this.renderer.width, this.renderer.height);
    };
    window.addEventListener('resize', this._onResize);
  }

  start() {
    this._running = true;
    this._lastTime = performance.now() / 1000;
    this._tick = this._loop.bind(this);
    requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
  }

  _loop(nowMs) {
    if (!this._running) return;
    requestAnimationFrame(this._tick);

    const now = nowMs / 1000;
    let frameTime = now - this._lastTime;
    this._lastTime = now;

    if (frameTime > this._maxFrameTime) {
      frameTime = this._maxFrameTime;
    }

    this._accumulator += frameTime;

    // Fixed update steps
    while (this._accumulator >= this._dt) {
      this.update(this._dt);
      this._accumulator -= this._dt;
    }

    this.render();
    this.input.endFrame();
  }

  update(dt) {
    switch (this.state) {
      case State.MENU:
        this._updateMenu(dt);
        break;
      case State.PLAYING:
        this._updatePlaying(dt);
        break;
      case State.SHOP:
        this._updateShop(dt);
        break;
      case State.GAME_OVER:
        this._updateGameOver(dt);
        break;
    }
  }

  render() {
    const r = this.renderer;
    r.clear(CONST.COLOR_SAND);

    switch (this.state) {
      case State.MENU:
        this._renderMenu(r);
        break;
      case State.PLAYING:
        this._renderPlaying(r);
        break;
      case State.SHOP:
        this._renderShop(r);
        break;
      case State.GAME_OVER:
        this._renderGameOver(r);
        break;
    }
  }

  // --- State transitions ---

  startGame() {
    this.audio.init();
    this.audio.startWind();
    this.state = State.PLAYING;
    this.wave = 1;
    this.score = 0;
    this.caravansRobbed = 0;
    this.caravans = [];
    this.guards = [];
    this.loots = [];
    this.particles = [];
    this.projectiles = [];
    this.floatingTexts = [];
    this.waveDamageTaken = 0; // track damage for flawless bonus

    // Reset shop upgrade tracking
    this.ui.reset();

    // Create player at world center
    this.player = new Player(this.world.width / 2, this.world.height / 2);

    // Center camera on player
    this.camera.x = this.player.pos.x - this.renderer.width / 2;
    this.camera.y = this.player.pos.y - this.renderer.height / 2;

    // Spawn first wave
    this._spawnWave();
  }

  _spawnWave() {
    const newCaravans = spawnWave(this.wave, this.world);
    this.caravans = newCaravans;
    this.guards = [];
    this.projectiles = [];
    this.waveDamageTaken = 0;
    for (const caravan of newCaravans) {
      const guards = caravan.spawnGuards(this.wave);
      this.guards.push(...guards);
    }
  }

  openShop() {
    this.state = State.SHOP;
  }

  startNextWave() {
    this.wave++;
    this.state = State.PLAYING;
    this._spawnWave();
  }

  gameOver() {
    this.state = State.GAME_OVER;
    this.audio.stopWind();
  }

  // --- Menu ---

  _updateMenu(dt) {
    if (this.input.wasPressed('Space') || this.input.wasPressed('Enter') || this.input.mouse.clicked) {
      this.startGame();
      this.input.endFrame(); // consume input so it doesn't trigger attack on first frame
    }
  }

  _renderMenu(r) {
    // Background - render world as backdrop
    this.world.render(r, this.camera);
    this.ui.renderMenu(r);
  }

  // --- Playing ---

  _updatePlaying(dt) {
    // Update player
    if (this.player) {
      this.player.update(dt, this.input, this.world.width, this.world.height);

      // Check for player death
      if (!this.player.alive) {
        this.gameOver();
        return;
      }

      // Handle player attack
      if (this.input.wantsAttack() && this.player.tryAttack()) {
        this.audio.playAttack();
        const hits = performAttack(this.player, this.guards, this.caravans);
        for (const hit of hits) {
          // Floating damage number
          this.addFloatingText(
            hit.target.pos.x, hit.target.pos.y - 20,
            `-${hit.damage}`, '#fff', 16
          );

          // Hit sparks and sound
          spawnHitSparks(this.particles, hit.target.pos.x, hit.target.pos.y);
          this.audio.playHit();
          this.camera.shake(3, 0.1);

          // Flash white on hit
          hit.target.flashTimer = 0.1;

          // Check if guard died
          if (hit.type === 'guard' && !hit.target.alive) {
            spawnDeathBurst(this.particles, hit.target.pos.x, hit.target.pos.y);
            this.audio.playGuardDeath();
            this._checkCaravanLoot(hit.target.caravan);
          }

          // Check if caravan was destroyed directly
          if (hit.type === 'caravan' && !hit.target.alive) {
            spawnDeathBurst(this.particles, hit.target.pos.x, hit.target.pos.y);
            this._checkCaravanLoot(hit.target);
          }
        }
      }
    }

    // Update caravans
    for (const caravan of this.caravans) {
      caravan.update(dt, this.player ? this.player.pos : caravan.pos);
    }

    // Update guards
    if (this.player) {
      for (const guard of this.guards) {
        guard.update(dt, this.player.pos);

        // Guard attacks player if close enough
        if (guard.canAttack(this.player.pos)) {
          const result = guard.attack(this.player.pos);
          if (result.ranged) {
            // Spawn projectile
            const proj = new Projectile(
              result.origin.x, result.origin.y,
              result.dir.x, result.dir.y,
              result.damage
            );
            this.projectiles.push(proj);
          } else {
            this.player.takeDamage(result.damage);
            this.waveDamageTaken += result.damage;
            this.player.flashTimer = 0.12;
            this.camera.shake(4, 0.15);
            this.audio.playPlayerHurt();
            this.addFloatingText(
              this.player.pos.x, this.player.pos.y - 20,
              `-${result.damage}`, CONST.COLOR_HP_BAR, 16
            );
          }
        }
      }
    }

    // Update projectiles
    if (this.player) {
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const proj = this.projectiles[i];
        const hit = proj.update(dt, this.player.pos, this.player.radius);
        if (hit) {
          this.player.takeDamage(proj.damage);
          this.waveDamageTaken += proj.damage;
          this.player.flashTimer = 0.12;
          this.camera.shake(3, 0.12);
          this.audio.playPlayerHurt();
          spawnHitSparks(this.particles, this.player.pos.x, this.player.pos.y);
          this.addFloatingText(
            this.player.pos.x, this.player.pos.y - 20,
            `-${proj.damage}`, CONST.COLOR_HP_BAR, 16
          );
        }
        if (!proj.alive) {
          this.projectiles.splice(i, 1);
        }
      }
    }

    // Update loot
    if (this.player) {
      for (let i = this.loots.length - 1; i >= 0; i--) {
        const loot = this.loots[i];
        const collected = loot.update(dt, this.player.pos, this.world.width, this.world.height);
        if (collected > 0) {
          this.player.addGold(collected);
          this.score += collected;
          spawnGoldSparkle(this.particles, loot.pos.x, loot.pos.y);
          this.audio.playCoin();
          this.addFloatingText(
            loot.pos.x, loot.pos.y - 10,
            `+${collected}`, CONST.COLOR_GOLD, 14
          );
        }
        if (!loot.alive) {
          this.loots.splice(i, 1);
        }
      }
    }

    // Dust particles from moving entities
    this._dustTimer -= dt;
    if (this._dustTimer <= 0) {
      this._dustTimer = 0.08;
      if (this.player && this.player.vel.lenSq() > 400) {
        spawnDust(this.particles, this.player.pos.x, this.player.pos.y, this.player.vel.x, this.player.vel.y);
      }
      for (const guard of this.guards) {
        if (guard.alive && guard.vel.lenSq() > 400) {
          spawnDust(this.particles, guard.pos.x, guard.pos.y, guard.vel.x, guard.vel.y);
        }
      }
    }

    // Update particles
    updateParticles(this.particles, dt);

    // Check wave completion: all caravans done (dead or escaped) and all loot collected
    if (this.caravans.length > 0) {
      const allDone = this.caravans.every(c => !c.alive);
      if (allDone && this.loots.length === 0) {
        // Flawless wave bonus
        if (this.waveDamageTaken === 0) {
          const bonus = CONST.FLAWLESS_WAVE_BONUS * this.wave;
          this.score += bonus;
          if (this.player) {
            this.player.addGold(bonus);
            this.addFloatingText(
              this.player.pos.x, this.player.pos.y - 40,
              `FLAWLESS! +${bonus}`, '#00ff88', 20
            );
          }
        }
        this.openShop();
      }
    }

    // Update camera shake
    this.camera.updateShake(dt);

    // Camera follows player if exists
    if (this.player) {
      this.camera.follow(this.player.pos, dt);
      this.camera.clampToWorld(this.world.width, this.world.height);
    }

    // Update floating texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= 40 * dt;
      ft.life -= dt;
      if (ft.life <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }
  }

  // Check if a caravan should drop loot (all its guards dead or caravan itself destroyed)
  _checkCaravanLoot(caravan) {
    if (!caravan || caravan.looted) return;

    // Caravan drops loot if it's dead OR all its guards are dead
    const allGuardsDead = caravan.guards.every(g => !g.alive);
    const shouldDrop = !caravan.alive || allGuardsDead;

    if (shouldDrop) {
      caravan.looted = true;
      if (caravan.alive) {
        caravan.alive = false; // kill the caravan if guards are all dead
      }
      const coins = spawnLoot(caravan);
      this.loots.push(...coins);
      this.caravansRobbed++;
    }
  }

  _renderPlaying(r) {
    r.save();
    this.camera.apply(r);

    // World terrain
    // We use the world's own render which draws the cached terrain
    r.restore();
    this.world.render(r, this.camera);
    r.save();
    this.camera.apply(r);

    // Caravans
    for (const caravan of this.caravans) {
      caravan.render(r);
    }

    // Loot (render under entities)
    for (const loot of this.loots) {
      loot.render(r);
    }

    // Guards
    for (const guard of this.guards) {
      guard.render(r);
    }

    // Projectiles
    for (const proj of this.projectiles) {
      proj.render(r);
    }

    // Player (render on top)
    if (this.player) {
      this.player.render(r);
    }

    // Particles (over entities)
    renderParticles(this.particles, r);

    // Floating texts
    for (const ft of this.floatingTexts) {
      const alpha = Math.max(0, ft.life / ft.maxLife);
      r.setAlpha(alpha);
      r.textOutlined(ft.text, ft.x, ft.y, ft.color, '#000', ft.size || 14, 'center', 'middle');
      r.resetAlpha();
    }

    r.restore();

    // HUD overlay
    this.ui.renderHUD(r, this);
  }

  // --- Shop ---

  _updateShop(dt) {
    // Handle mouse clicks on shop items
    if (this.input.mouse.clicked && this.player) {
      const mx = this.input.mouse.x;
      const my = this.input.mouse.y;

      // Check upgrade buttons
      const idx = this.ui.handleShopClick(mx, my);
      if (idx >= 0) {
        this.ui.tryPurchase(idx, this.player);
      }

      // Check "next wave" button
      if (this.ui.isNextWaveClicked(mx, my)) {
        this.startNextWave();
        return;
      }
    }

    // Keyboard shortcut to start next wave
    if (this.input.wasPressed('Space') || this.input.wasPressed('Enter')) {
      this.startNextWave();
      this.input.endFrame(); // consume input so it doesn't trigger attack on first frame
    }
  }

  _renderShop(r) {
    this.ui.renderShop(r, this.player);
  }

  // --- Game Over ---

  _updateGameOver(dt) {
    if (this.input.wasPressed('Space') || this.input.wasPressed('Enter') || this.input.mouse.clicked) {
      this.state = State.MENU;
      this.input.endFrame(); // consume input so it doesn't immediately start a new game
    }
  }

  _renderGameOver(r) {
    this.ui.renderGameOver(r, this);
  }

  // --- Helpers ---

  addFloatingText(x, y, text, color = '#fff', size = 14) {
    this.floatingTexts.push({
      x, y, text, color, size,
      life: 1.0,
      maxLife: 1.0,
    });
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    this.input.destroy();
    this.audio.stopWind();
    this.stop();
  }
}
