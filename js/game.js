// Game - main game class with fixed-timestep loop and state machine

import { CONST } from './utils.js';
import { Camera } from './camera.js';
import { World } from './world.js';
import { Player } from './player.js';
import { spawnWave } from './caravan.js';
import { performAttack } from './combat.js';
import { spawnLoot } from './loot.js';

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

    this.state = State.MENU;
    this.wave = 0;
    this.score = 0;
    this.caravansRobbed = 0;

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
    for (const caravan of newCaravans) {
      const guards = caravan.spawnGuards();
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
  }

  // --- Menu ---

  _updateMenu(dt) {
    if (this.input.wasPressed('Space') || this.input.wasPressed('Enter') || this.input.mouse.clicked) {
      this.startGame();
    }
  }

  _renderMenu(r) {
    const cx = r.width / 2;
    const cy = r.height / 2;

    // Background - render world as backdrop
    this.world.render(r, this.camera);

    // Overlay
    r.setAlpha(0.7);
    r.rect(0, 0, r.width, r.height, '#1a1a2e');
    r.resetAlpha();

    // Title
    r.textOutlined('КОРОВАНЫ', cx, cy - 100, '#ffd700', '#000', 64, 'center', 'middle');

    // Subtitle
    r.textOutlined('грабь корованы!', cx, cy - 30, '#e8c872', '#000', 24, 'center', 'middle');

    // Instructions
    r.textOutlined('WASD / стрелки - движение', cx, cy + 40, '#ccc', '#000', 16, 'center', 'middle');
    r.textOutlined('Пробел / клик - атака', cx, cy + 65, '#ccc', '#000', 16, 'center', 'middle');

    // Start prompt
    const blink = Math.sin(performance.now() / 300) > 0;
    if (blink) {
      r.textOutlined('[ Нажми чтобы начать ]', cx, cy + 130, '#fff', '#000', 20, 'center', 'middle');
    }
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
        const hits = performAttack(this.player, this.guards, this.caravans);
        for (const hit of hits) {
          // Floating damage number
          this.addFloatingText(
            hit.target.pos.x, hit.target.pos.y - 20,
            `-${hit.damage}`, '#fff', 16
          );

          // Check if guard died
          if (hit.type === 'guard' && !hit.target.alive) {
            // No loot from individual guards, but check if caravan should drop loot
            this._checkCaravanLoot(hit.target.caravan);
          }

          // Check if caravan was destroyed directly
          if (hit.type === 'caravan' && !hit.target.alive) {
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
          const dmg = guard.attack();
          this.player.takeDamage(dmg);
          this.addFloatingText(
            this.player.pos.x, this.player.pos.y - 20,
            `-${dmg}`, CONST.COLOR_HP_BAR, 16
          );
        }
      }
    }

    // Update loot
    if (this.player) {
      for (let i = this.loots.length - 1; i >= 0; i--) {
        const loot = this.loots[i];
        const collected = loot.update(dt, this.player.pos);
        if (collected > 0) {
          this.player.addGold(collected);
          this.score += collected;
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

    // Check wave completion: all caravans done (dead or escaped) and all loot collected
    if (this.caravans.length > 0) {
      const allDone = this.caravans.every(c => !c.alive);
      if (allDone && this.loots.length === 0) {
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

    // Player (render on top)
    if (this.player) {
      this.player.render(r);
    }

    // Floating texts
    for (const ft of this.floatingTexts) {
      const alpha = Math.max(0, ft.life / ft.maxLife);
      r.setAlpha(alpha);
      r.textOutlined(ft.text, ft.x, ft.y, ft.color, '#000', ft.size || 14, 'center', 'middle');
      r.resetAlpha();
    }

    r.restore();

    // HUD
    r.rect(0, 0, r.width, CONST.HUD_HEIGHT, 'rgba(0,0,0,0.5)');
    r.text(`Волна: ${this.wave}`, 10, 10, '#fff', 16);
    r.text(`Счёт: ${this.score}`, 150, 10, CONST.COLOR_GOLD, 16);
    if (this.player) {
      // HP bar in HUD
      r.healthBar(280, 12, 100, 14, this.player.hp / this.player.maxHp, CONST.COLOR_HP_BAR, CONST.COLOR_HP_BG);
      r.text(`${this.player.hp}/${this.player.maxHp}`, 390, 10, '#fff', 14);
      // Gold
      r.text(`\u2B50 ${this.player.gold}`, 470, 10, CONST.COLOR_GOLD, 16);
    }
    // Enemy/caravan count
    const aliveCaravans = this.caravans.filter(c => c.alive).length;
    const aliveGuards = this.guards.filter(g => g.alive).length;
    r.text(`Корованы: ${aliveCaravans}  Охрана: ${aliveGuards}`, 570, 10, '#ddd', 14);
  }

  // --- Shop ---

  _updateShop(dt) {
    if (this.input.wasPressed('Space') || this.input.wasPressed('Enter')) {
      this.startNextWave();
    }
  }

  _renderShop(r) {
    const cx = r.width / 2;
    const cy = r.height / 2;

    r.rect(0, 0, r.width, r.height, '#1a1a2e');
    r.textOutlined('МАГАЗИН', cx, 60, '#ffd700', '#000', 40, 'center', 'middle');
    r.textOutlined(`Золото: ${this.player ? this.player.gold : 0}`, cx, 110, CONST.COLOR_GOLD, '#000', 20, 'center', 'middle');
    r.textOutlined('[ Пробел - следующая волна ]', cx, cy + 200, '#aaa', '#000', 16, 'center', 'middle');
  }

  // --- Game Over ---

  _updateGameOver(dt) {
    if (this.input.wasPressed('Space') || this.input.wasPressed('Enter') || this.input.mouse.clicked) {
      this.state = State.MENU;
    }
  }

  _renderGameOver(r) {
    const cx = r.width / 2;
    const cy = r.height / 2;

    r.rect(0, 0, r.width, r.height, '#1a1a2e');
    r.textOutlined('КОНЕЦ ИГРЫ', cx, cy - 80, '#e74c3c', '#000', 48, 'center', 'middle');
    r.textOutlined(`Волн пережито: ${this.wave}`, cx, cy - 10, '#fff', '#000', 20, 'center', 'middle');
    r.textOutlined(`Корованов ограблено: ${this.caravansRobbed}`, cx, cy + 25, '#fff', '#000', 20, 'center', 'middle');
    r.textOutlined(`Счёт: ${this.score}`, cx, cy + 60, CONST.COLOR_GOLD, '#000', 24, 'center', 'middle');

    const blink = Math.sin(performance.now() / 300) > 0;
    if (blink) {
      r.textOutlined('[ Нажми чтобы продолжить ]', cx, cy + 130, '#aaa', '#000', 16, 'center', 'middle');
    }
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
    this.stop();
  }
}
