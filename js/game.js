// Game - main game class with fixed-timestep loop and state machine

import { Vec2, CONST } from './utils.js';
import { Camera } from './camera.js';
import { World } from './world.js';
import { Player } from './player.js';
import { spawnWave, resolveGuardCollisions } from './caravan.js';
import { performAttack, Projectile } from './combat.js';
import { spawnLoot } from './loot.js';
import { UI } from './ui.js';
import { Shop } from './shop.js';
import { spawnDust, spawnHitSparks, spawnGoldSparkle, spawnDeathBurst, spawnSlash, spawnDashTrail, updateParticles, renderParticles } from './particles.js';
import { GameAudio } from './audio.js';
import { recordRun, getBestScore } from './storage.js';
import { SessionLogger, clearAllSessions, countSessions, uploadAllLocal } from './session-logger.js';

// Game states
export const State = {
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  SHOP: 'shop',
  GAME_OVER: 'gameover',
};

export class Game {
  constructor(renderer, input, options = {}) {
    this.renderer = renderer;
    this.input = input;
    this.camera = new Camera(renderer.width, renderer.height);
    this.world = new World();
    this.ui = new UI();

    // Persistent in-world shop. Placed a bit north-east of player spawn so
    // it's visible immediately when the game starts. Off the road vertically.
    this.shop = new Shop(this.world.width / 2 + 150, this.world.height / 2 - 140);
    this.shopOrigin = null; // 'wave' | 'world' — how we entered the shop state

    // Telemetry logger. Tagged with the current build commit so logs from
    // different code versions can be compared.
    this.build = options.build || { commit: 'unknown', short: 'unknown' };
    this.logger = new SessionLogger({ commit: this.build.commit });
    this._waveStartMs = 0;

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
    // Global hotkeys (work in any state where they make sense).
    if (this.input.wasPressed('KeyM')) {
      this.audio.toggleMute();
    }

    switch (this.state) {
      case State.MENU:
        this._updateMenu(dt);
        break;
      case State.PLAYING:
        // Allow pausing mid-fight.
        if (this.input.wasPressed('Escape') || this.input.wasPressed('KeyP')) {
          this.state = State.PAUSED;
          this.input.endFrame();
          break;
        }
        this._updatePlaying(dt);
        break;
      case State.PAUSED:
        this._updatePaused(dt);
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
      case State.PAUSED:
        // Render the frozen playing state under a paused overlay.
        this._renderPlaying(r);
        this.ui.renderPaused(r);
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
    this.newRecord = false;

    // Reset shop upgrade tracking
    this.ui.reset();

    // Start a fresh telemetry session tagged with the current build.
    this.logger.startSession({ build: this.build });

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
    this._waveStartMs = Date.now();
    const isBoss = this.wave % 5 === 0;
    this.logger.logWaveStart(this.wave, {
      caravans: newCaravans.length,
      guards: this.guards.length,
      boss: isBoss,
    });
  }

  // Open the shop. `origin = 'wave'` is the mandatory end-of-wave free draft,
  // `origin = 'world'` is the in-world shop where picks cost gold.
  openShop(origin = 'wave') {
    this.state = State.SHOP;
    this.shopOrigin = origin;
    if (origin === 'wave') {
      this.ui.beginFreeDraft(null, this.player);
    } else {
      this.ui.beginPaidDraft(this.wave);
    }
    this.logger.logShopOpened(origin, this.wave);
    this.input.endFrame();
  }

  startNextWave() {
    this.wave++;
    this.state = State.PLAYING;
    // Invalidate the persistent paid shop offer so a fresh set of cards
    // shows up on the first shop visit of the new wave.
    this.ui.onWaveStart();
    // Respawn the player in the middle of the desert so they don't end up
    // inside the caravan path where the previous wave ended. Stats and HP
    // carry over, but position / motion / dash state are reset.
    if (this.player) {
      this.player.respawnAt(this.world.width / 2, this.world.height / 2);
      // Snap the camera so there's no jarring scroll into the new spawn.
      this.camera.x = this.player.pos.x - this.renderer.width / 2;
      this.camera.y = this.player.pos.y - this.renderer.height / 2;
      this.camera.clampToWorld(this.world.width, this.world.height);
    }
    this._spawnWave();
  }

  // Close the in-world shop and resume the current wave without advancing.
  closeShopToPlaying() {
    this.logger.logShopClosed('world', this.wave);
    this.state = State.PLAYING;
    this.shopOrigin = null;
    this.input.endFrame();
  }

  gameOver() {
    this.state = State.GAME_OVER;
    this.audio.stopWind();
    this.newRecord = recordRun(this.score, this.wave);
    this.logger.logDeath(this.wave, this.score);
    this.logger.endSession({
      died: true,
      finalScore: this.score,
      waveReached: this.wave,
    });
  }

  _updatePaused(dt) {
    if (
      this.input.wasPressed('Escape') ||
      this.input.wasPressed('KeyP') ||
      this.input.wasPressed('Space') ||
      this.input.wasPressed('Enter')
    ) {
      this.state = State.PLAYING;
      this.input.endFrame();
    }
  }

  // --- Menu ---

  _updateMenu(dt) {
    // Log export shortcuts — only on the main menu so they don't clash
    // with gameplay input. L downloads everything, Shift+L clears.
    if (this.input.wasPressed('KeyL')) {
      const shift = this.input.keys['ShiftLeft'] || this.input.keys['ShiftRight'];
      console.log(`[menu] KeyL pressed (shift=${!!shift}) — ${shift ? 'clearing sessions' : 'downloading export'}`);
      if (shift) {
        clearAllSessions();
      } else {
        this.logger.downloadExport();
      }
      this.input.endFrame();
      return;
    }

    // U: backfill every session from localStorage to the telemetry
    // server (for sessions collected while offline).
    if (this.input.wasPressed('KeyU')) {
      console.log('[menu] KeyU pressed — starting telemetry backfill');
      uploadAllLocal()
        .then((r) => console.log(`[telemetry] backfill: sent=${r.sent} failed=${r.failed}`))
        .catch((err) => console.error('[telemetry] backfill failed:', err));
      this.input.endFrame();
      return;
    }

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
      // Let input resolve touch-based movement direction relative to the
      // player's current screen position.
      this.input.setPlayerScreen(
        this.player.pos.x - this.camera.x,
        this.player.pos.y - this.camera.y
      );
      // Enter the in-world shop when near it. E is the common convention.
      if (this.input.wasPressed('KeyE') && this.shop.isPlayerNear(this.player.pos)) {
        this.openShop('world');
        return;
      }

      // Dash input: Shift (either side). Use current movement vector so the
      // dash goes where the player is actively moving; fall back to facing if
      // standing still.
      if (this.input.wasPressed('ShiftLeft') || this.input.wasPressed('ShiftRight')) {
        const move = this.input.getMovement();
        if (this.player.startDash(move.x, move.y)) {
          this.audio.playDash();
          this.logger.logDash(this.wave);
          spawnDashTrail(
            this.particles,
            this.player.pos.x, this.player.pos.y,
            this.player.dashDir.x, this.player.dashDir.y
          );
        }
      }

      this.player.update(dt, this.input, this.world.width, this.world.height);

      // Check for player death
      if (!this.player.alive) {
        this.gameOver();
        return;
      }

      // Continuous dash trail while the dash is active.
      if (this.player.dashTimer > 0) {
        spawnDashTrail(
          this.particles,
          this.player.pos.x, this.player.pos.y,
          this.player.dashDir.x, this.player.dashDir.y
        );
      }

      // Handle player attack
      if (this.input.wantsAttack()) {
        // Click / tap reaims the player toward the cursor before attacking.
        // Space uses whatever facing the player already has (from movement).
        if (this.input.mouse.clicked) {
          const world = this.camera.screenToWorld(this.input.mouse.x, this.input.mouse.y);
          const dx = world.x - this.player.pos.x;
          const dy = world.y - this.player.pos.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0.01) {
            this.player.facing = new Vec2(dx / len, dy / len);
          }
        }
        if (this.player.tryAttack()) {
          this.audio.playAttack();
          this.logger.logAttack();
          spawnSlash(
            this.particles,
            this.player.pos.x,
            this.player.pos.y,
            this.player.facing.x,
            this.player.facing.y,
            this.player.radius + this.player.attackRange
          );
          const hits = performAttack(this.player, this.guards, this.caravans);
          // Lifesteal: heal a fraction of total dealt damage this swing.
          if (this.player.lifestealPct > 0 && hits.length > 0) {
            const totalDmg = hits.reduce((s, h) => s + h.damage, 0);
            const heal = Math.floor(totalDmg * this.player.lifestealPct);
            if (heal > 0) {
              this.player.heal(heal);
              this.addFloatingText(
                this.player.pos.x, this.player.pos.y - 32,
                `+${heal}`, '#d46a7a', 14
              );
            }
          }
          for (const hit of hits) {
            // Floating damage number
            this.addFloatingText(
              hit.target.pos.x, hit.target.pos.y - 20,
              `-${hit.damage}`, '#fff', 16
            );

            this.logger.logDamageDealt(hit.damage);

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
              this.logger.logGuardKilled(hit.target.type, this.wave);
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
            const hpBefore = this.player.hp;
            this.player.takeDamage(result.damage);
            // Turn toward the attacker so a counter-attack lands naturally.
            this.player.face(guard.pos.x - this.player.pos.x, guard.pos.y - this.player.pos.y);
            // takeDamage is a no-op during i-frames, so only count what
            // actually landed.
            const actual = hpBefore - this.player.hp;
            if (actual > 0) {
              this.waveDamageTaken += actual;
              this.player.flashTimer = 0.12;
              this.camera.shake(4, 0.15);
              this.audio.playPlayerHurt();
              this.addFloatingText(
                this.player.pos.x, this.player.pos.y - 20,
                `-${actual}`, CONST.COLOR_HP_BAR, 16
              );
              this.logger.logPlayerDamaged(actual, `guard:${guard.type}`, this.wave, this.player.hp);
            }
            // Thorns: reflect a fraction of melee damage back at the attacker.
            if (this.player.thornsPct > 0 && guard.alive && actual > 0) {
              const reflected = Math.max(1, Math.round(actual * this.player.thornsPct));
              guard.takeDamage(reflected);
              guard.flashTimer = 0.1;
              this.addFloatingText(
                guard.pos.x, guard.pos.y - 20,
                `-${reflected}`, '#6bbf4a', 14
              );
              this.logger.logDamageReflected(reflected);
              if (!guard.alive) {
                spawnDeathBurst(this.particles, guard.pos.x, guard.pos.y);
                this.audio.playGuardDeath();
                this.logger.logGuardKilled(guard.type, this.wave, 'thorns');
                this._checkCaravanLoot(guard.caravan);
              }
            }
          }
        }
      }
    }

    // Separate overlapping guards and push them out of caravans so sprites
    // don't stack on the same pixel.
    resolveGuardCollisions(this.guards, this.caravans);

    // Update projectiles
    if (this.player) {
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const proj = this.projectiles[i];
        const hit = proj.update(dt, this.player.pos, this.player.radius);
        if (hit) {
          const hpBefore = this.player.hp;
          this.player.takeDamage(proj.damage);
          this.player.face(-proj.dir.x, -proj.dir.y);
          const actual = hpBefore - this.player.hp;
          if (actual > 0) {
            this.waveDamageTaken += actual;
            this.player.flashTimer = 0.12;
            this.camera.shake(3, 0.12);
            this.audio.playPlayerHurt();
            spawnHitSparks(this.particles, this.player.pos.x, this.player.pos.y);
            this.addFloatingText(
              this.player.pos.x, this.player.pos.y - 20,
              `-${actual}`, CONST.COLOR_HP_BAR, 16
            );
            this.logger.logPlayerDamaged(actual, 'arrow', this.wave, this.player.hp);
          }
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
        const collected = loot.update(
          dt, this.player.pos, this.world.width, this.world.height,
          this.player.magnetRangeMul
        );
        if (collected > 0) {
          this.player.addGold(collected);
          this.score += collected;
          this.logger.logGoldEarned(collected);
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
        // Flawless wave bonus (must have robbed at least one caravan)
        const anyRobbed = this.caravans.some(c => !c.escaped);
        if (this.waveDamageTaken === 0 && anyRobbed) {
          const bonus = CONST.FLAWLESS_WAVE_BONUS * this.wave;
          this.score += bonus;
          if (this.player) {
            this.player.addGold(bonus);
            this.logger.logGoldEarned(bonus);
            this.addFloatingText(
              this.player.pos.x, this.player.pos.y - 40,
              `FLAWLESS! +${bonus}`, '#00ff88', 20
            );
          }
          this.logger.logFlawless(this.wave, bonus);
        }
        const escaped = this.caravans.filter(c => c.escaped).length;
        const robbed = this.caravans.filter(c => !c.escaped).length;
        this.logger.logWaveEnd(this.wave, {
          durationMs: Date.now() - this._waveStartMs,
          damageTaken: this.waveDamageTaken,
          caravansRobbed: robbed,
          caravansEscaped: escaped,
        });
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
      this.logger.logCaravanRobbed(
        caravan.type,
        caravan.lootValue,
        this.wave,
        !!caravan.isBoss
      );
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

    // In-world shop building (under entities so they render on top if overlap)
    this.shop.render(r);

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

    // Shop interaction prompt (drawn over the player so it's always readable).
    if (this.player && this.shop.isPlayerNear(this.player.pos)) {
      this.shop.renderInteractPrompt(r);
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

  // --- Shop / Draft ---

  _closeShop() {
    if (this.shopOrigin === 'world') {
      this.closeShopToPlaying();
    } else {
      this.startNextWave();
    }
  }

  _updateShop(dt) {
    if (this.input.mouse.clicked && this.player) {
      const mx = this.input.mouse.x;
      const my = this.input.mouse.y;

      // Click on a draft card → apply effect. In free mode one pick closes
      // the shop; in paid mode the card is just removed from the offer and
      // the player can keep shopping.
      const idx = this.ui.handleDraftClick(mx, my);
      if (idx >= 0) {
        const card = this.ui.draftOffer[idx] || null;
        const cost = this.shopOrigin === 'world' ? this.ui.getCardCost(card) : 0;
        const applied = this.ui.pickCard(idx, this.player);
        if (applied && card) {
          this.logger.logCardPicked(
            card.id,
            card.rarity,
            this.shopOrigin === 'world' ? 'paid' : 'free',
            cost,
            this.wave
          );
          if (cost > 0) this.logger.logGoldSpent(cost);
        }
        if (applied && this.shopOrigin === 'wave') {
          this.startNextWave();
        } else if (applied && this.shopOrigin === 'world') {
          // Paid shop: one purchase per wave. Auto-close so the player
          // gets unambiguous feedback that the allowance is spent — same
          // rhythm as the free draft closing on a single pick.
          this.closeShopToPlaying();
        }
        this.input.endFrame();
        return;
      }

      // Reroll offers for gold.
      if (this.ui.isRerollClicked(mx, my)) {
        const rerollCost = this.ui.getRerollCost();
        if (this.ui.tryReroll(this.player)) {
          this.logger.logReroll(
            this.shopOrigin === 'world' ? 'paid' : 'free',
            rerollCost,
            this.wave
          );
          this.logger.logGoldSpent(rerollCost);
        }
        this.input.endFrame();
        return;
      }

      // Close / skip button.
      if (this.ui.isSkipClicked(mx, my)) {
        this._closeShop();
        return;
      }
    }

    // Enter = skip / close.
    if (this.input.wasPressed('Enter')) {
      this._closeShop();
      return;
    }

    // In world-shop mode Esc/E exits without advancing the wave.
    if (this.shopOrigin === 'world' && (
      this.input.wasPressed('Escape') || this.input.wasPressed('KeyE')
    )) {
      this._closeShop();
      return;
    }
  }

  _renderShop(r) {
    this.ui.renderShop(r, this.player, this);
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
