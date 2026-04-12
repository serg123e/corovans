// AIController - bridges an AI policy to a live Game instance.
//
// Each tick (called by Game.update before input is read), the controller
// observes game state, runs the policy, and writes the resulting action
// into the AIInput. The game loop then processes the input through its
// normal code paths — same rendering, particles, audio, and telemetry
// as a human player session.
//
// Usage: open index.html?ai=smart (or greedy, runner, etc.)

import { State } from './game.js';

// Wall-clock delays (ms) so each state is visible before the AI acts.
const MENU_DELAY = 1000;
const SHOP_DELAY = 400;
const GAME_OVER_DELAY = 3000;

export class AIController {
  constructor(policy, aiInput) {
    this.policy = policy;
    this.input = aiInput;
    this._prevState = null;
    this._stateEnteredAt = 0;
  }

  tick(game) {
    this.input.beginTick();

    // Track state transitions for visual delays.
    if (game.state !== this._prevState) {
      this._stateEnteredAt = performance.now();
      this._prevState = game.state;
    }
    const age = performance.now() - this._stateEnteredAt;

    switch (game.state) {
      case State.MENU:
        if (age > MENU_DELAY) this.input.press('Space');
        break;
      case State.PLAYING:
        this._tickPlaying(game);
        break;
      case State.SHOP:
        if (age > SHOP_DELAY) this._tickShop(game);
        break;
      case State.GAME_OVER:
        if (age > GAME_OVER_DELAY) this.input.press('Space');
        break;
      // PAUSED: do nothing — let the human spectator unpause with Esc.
    }
  }

  _tickPlaying(game) {
    const player = game.player;
    if (!player || !player.alive) return;

    const view = {
      wave: game.wave,
      player: this._playerView(player),
      caravans: game.caravans,
      guards: game.guards,
      projectiles: game.projectiles,
      loots: game.loots,
      shop: game.shop,
    };

    const action = this.policy.decidePlaying(view) || {};

    this.input.setMove(action.moveX || 0, action.moveY || 0);
    if (action.attack) this.input.press('Space');
    if (action.dash) this.input.press('ShiftLeft');
  }

  _tickShop(game) {
    const player = game.player;
    if (!player) return;

    // Wait for render to populate card hit-test rects on the first shop frame.
    if (game.ui.draftOffer.length > 0 && game.ui._cardButtons.length === 0) {
      return;
    }

    const shopOffer = game.ui.draftOffer.slice();
    const shopView = {
      wave: game.wave,
      mode: game.shopOrigin === 'world' ? 'paid' : 'free',
      offer: shopOffer,
      costs: shopOffer.map(c => game.ui.getCardCost(c)),
      player: this._playerView(player),
      gold: player.gold,
    };

    const decision = this.policy.decideShop(shopView) || { action: 'skip' };

    if (decision.action === 'pick' && typeof decision.index === 'number') {
      const btn = game.ui._cardButtons[decision.index];
      if (btn) {
        this.input.click(btn.x + btn.w / 2, btn.y + btn.h / 2);
      } else {
        this.input.press('Enter');
      }
    } else if (decision.action === 'reroll') {
      const btn = game.ui._rerollButton;
      if (btn) {
        this.input.click(btn.x + btn.w / 2, btn.y + btn.h / 2);
      } else {
        this.input.press('Enter');
      }
    } else {
      this.input.press('Enter');
    }
  }

  _playerView(player) {
    return {
      pos: player.pos,
      hp: player.hp,
      maxHp: player.maxHp,
      gold: player.gold,
      damage: player.damage,
      speed: player.speed,
      radius: player.radius,
      attackRange: player.attackRange,
      attackTimer: player.attackTimer,
      dashCooldownTimer: player.dashCooldownTimer,
      dashCooldownMax: player.dashCooldownMax,
      iframeTimer: player.iframeTimer,
      alive: player.alive,
      lifestealPct: player.lifestealPct,
      thornsPct: player.thornsPct,
      magnetRangeMul: player.magnetRangeMul,
    };
  }
}
