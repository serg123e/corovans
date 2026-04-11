// Player - bandit character with movement, animation, and stats

import { Vec2, CONST, clamp } from './utils.js';

// Animation states
const Anim = {
  IDLE: 'idle',
  WALK: 'walk',
  ATTACK: 'attack',
};

// Pixel art sprite definitions for the bandit
// Each frame is an array of rows; palette maps chars to colors
const SPRITE_PALETTE = {
  'H': '#2c1810', // hat dark
  'h': '#3d2817', // hat
  'F': '#d4a574', // face/skin
  'E': '#1a1a1a', // eyes
  'B': '#1a1a1a', // bandana/mask
  'b': '#333',    // bandana dark
  'C': '#c0392b', // coat (red)
  'c': '#992d22', // coat dark
  'P': '#5a4a3a', // pants
  'p': '#4a3a2a', // pants dark
  'S': '#6b5b4b', // shoes
  'A': '#8a7a6a', // arms/hands
};

const SPRITE_IDLE = [
  ' .HHH. ',
  ' hhhhh ',
  ' .FEF. ',
  ' .BBB. ',
  ' CCCCC ',
  ' cCCCc ',
  ' .CCC. ',
  ' .PPP. ',
  ' pP.Pp ',
  ' SS.SS ',
];

const SPRITE_WALK_1 = [
  ' .HHH. ',
  ' hhhhh ',
  ' .FEF. ',
  ' .BBB. ',
  'ACCCCA ',
  ' cCCCc ',
  ' .CCC. ',
  ' .PPP. ',
  ' pP..P ',
  ' SS..S ',
];

const SPRITE_WALK_2 = [
  ' .HHH. ',
  ' hhhhh ',
  ' .FEF. ',
  ' .BBB. ',
  ' ACCCA ',
  ' cCCCc ',
  ' .CCC. ',
  ' .PPP. ',
  ' P..Pp ',
  ' S..SS ',
];

const SPRITE_ATTACK = [
  ' .HHH. ',
  ' hhhhh ',
  ' .FEF. ',
  ' .BBB. ',
  'ACCCCCAA',
  ' cCCCc  ',
  ' .CCC.  ',
  ' .PPP.  ',
  ' pP.Pp  ',
  ' SS.SS  ',
];

export class Player {
  constructor(x, y) {
    this.pos = new Vec2(x, y);
    this.vel = new Vec2(0, 0);
    this.radius = CONST.PLAYER_RADIUS;

    // Stats
    this.maxHp = CONST.PLAYER_MAX_HP;
    this.hp = this.maxHp;
    this.damage = CONST.PLAYER_BASE_DAMAGE;
    this.speed = CONST.PLAYER_SPEED;
    this.attackRange = CONST.PLAYER_ATTACK_RANGE;
    this.attackCooldown = CONST.PLAYER_ATTACK_COOLDOWN;
    this.regenPerSec = CONST.PLAYER_HP_REGEN_PER_SEC;

    // Card-driven modifiers
    this.lifestealPct = 0;   // 0..1, heal % of dealt damage
    this.thornsPct = 0;      // 0..1, reflect % of incoming melee damage
    this.magnetRangeMul = 1; // 1 = default, cards scale up
    this.fullArcAttack = false; // true = attack hits in full 360° arc

    // Resources
    this.gold = 0;

    // Movement
    this.accel = CONST.PLAYER_ACCEL;
    this.friction = CONST.PLAYER_FRICTION;
    this.facing = new Vec2(0, 1); // direction the player is facing

    // Animation
    this.anim = Anim.IDLE;
    this.animTimer = 0;
    this.animFrame = 0;
    this.walkFrames = [SPRITE_WALK_1, SPRITE_WALK_2];

    // Combat state
    this.attackTimer = 0;
    this.alive = true;
    this.regenAccum = 0;
    this.isAttacking = false;
    this.attackAnimTimer = 0;
    this.attackAnimDuration = 0.2; // seconds the attack anim plays

    // Dash state
    this.dashTimer = 0;            // counts down while dash is active
    this.dashCooldownTimer = 0;    // counts down until dash is ready again
    this.dashCooldownMax = CONST.PLAYER_DASH_COOLDOWN; // mutable via cards
    this.iframeTimer = 0;          // invulnerability window during dash
    this.dashDir = new Vec2(1, 0); // locked direction while dashing

    // Visual juice
    this.flashTimer = 0; // flash white on damage
    this.squashX = 1;    // squash/stretch scale
    this.squashY = 1;
  }

  update(dt, input, worldW, worldH) {
    if (!this.alive) return;

    // Tick dash timers first — dash state overrides normal movement.
    if (this.dashCooldownTimer > 0) this.dashCooldownTimer -= dt;
    if (this.dashTimer > 0) this.dashTimer -= dt;
    if (this.iframeTimer > 0) this.iframeTimer -= dt;

    const isDashing = this.dashTimer > 0;

    if (isDashing) {
      // Lock velocity and facing to the dash direction. Ignore input so the
      // dash can't be "cancelled" mid-air by WASD.
      this.vel = this.dashDir.mul(CONST.PLAYER_DASH_SPEED);
      this.facing = this.dashDir.copy();
    } else {
      // Normal acceleration/friction movement.
      const move = input.getMovement();
      const moveVec = new Vec2(move.x, move.y);

      if (moveVec.lenSq() > 0) {
        const accelVec = moveVec.mul(this.accel * dt);
        this.vel = this.vel.add(accelVec);
        this.vel = this.vel.clampLen(this.speed);
        this.facing = moveVec.normalize();
      }

      const frictionMul = Math.exp(-this.friction * dt);
      this.vel = this.vel.mul(frictionMul);

      if (this.vel.lenSq() < 1) {
        this.vel.x = 0;
        this.vel.y = 0;
      }
    }

    // Update position
    this.pos = this.pos.add(this.vel.mul(dt));

    // Clamp to world boundaries
    this.pos.x = clamp(this.pos.x, this.radius, worldW - this.radius);
    this.pos.y = clamp(this.pos.y, this.radius, worldH - this.radius);

    // Update attack cooldown
    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
    }

    // Passive health regeneration. HP is displayed as an integer, so we
    // accumulate fractional regen and apply it one whole point at a time.
    if (this.hp < this.maxHp) {
      this.regenAccum += this.regenPerSec * dt;
      if (this.regenAccum >= 1) {
        const whole = Math.floor(this.regenAccum);
        this.hp = Math.min(this.maxHp, this.hp + whole);
        this.regenAccum -= whole;
      }
    } else {
      this.regenAccum = 0;
    }

    // Update animation
    this._updateAnimation(dt);
  }

  // Try to start a dash in the given direction. If the input vector is zero,
  // falls back to the current facing direction so a stationary player can
  // still dash forward. Returns true if the dash was started.
  startDash(dirX = 0, dirY = 0) {
    if (!this.alive) return false;
    if (this.dashCooldownTimer > 0 || this.dashTimer > 0) return false;

    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    let dx, dy;
    if (len > 0.001) {
      dx = dirX / len;
      dy = dirY / len;
    } else {
      dx = this.facing.x;
      dy = this.facing.y;
    }
    this.dashDir = new Vec2(dx, dy);
    this.facing = this.dashDir.copy();
    this.dashTimer = CONST.PLAYER_DASH_DURATION;
    this.iframeTimer = CONST.PLAYER_DASH_IFRAME_DURATION;
    this.dashCooldownTimer = this.dashCooldownMax;
    return true;
  }

  // Try to start an attack. Returns true if attack was initiated.
  tryAttack() {
    if (!this.alive || this.attackTimer > 0) return false;
    this.attackTimer = this.attackCooldown;
    this.isAttacking = true;
    this.attackAnimTimer = this.attackAnimDuration;
    this.anim = 'attack';
    // Squash/stretch on attack: stretch horizontally in facing direction
    this.squashX = 1.3;
    this.squashY = 0.75;
    return true;
  }

  _updateAnimation(dt) {
    // Flash timer
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
    }

    // Squash/stretch: lerp back to 1
    this.squashX += (1 - this.squashX) * Math.min(1, 12 * dt);
    this.squashY += (1 - this.squashY) * Math.min(1, 12 * dt);

    // Attack animation takes priority
    if (this.attackAnimTimer > 0) {
      this.attackAnimTimer -= dt;
      this.anim = Anim.ATTACK;
      if (this.attackAnimTimer <= 0) {
        this.isAttacking = false;
      }
      return;
    }

    const moving = this.vel.lenSq() > 100; // threshold to switch to walk

    if (moving) {
      this.anim = Anim.WALK;
      this.animTimer += dt;
      // Walk cycle: switch frame every 0.15 seconds
      const frameDuration = 0.15;
      this.animFrame = Math.floor(this.animTimer / frameDuration) % this.walkFrames.length;
    } else {
      this.anim = Anim.IDLE;
      this.animTimer = 0;
      this.animFrame = 0;
    }
  }

  render(renderer) {
    if (!this.alive) return;

    const x = this.pos.x;
    const y = this.pos.y;

    // Choose sprite based on animation state
    let sprite;
    if (this.anim === Anim.ATTACK) {
      sprite = SPRITE_ATTACK;
    } else if (this.anim === Anim.WALK) {
      sprite = this.walkFrames[this.animFrame];
    } else {
      sprite = SPRITE_IDLE;
    }

    // Flip sprite horizontally if facing left
    const flipH = this.facing.x < -0.1;
    const drawSprite = flipH ? sprite.map(row => row.split('').reverse().join('')) : sprite;

    // Apply squash/stretch transform
    const needsTransform = Math.abs(this.squashX - 1) > 0.01 || Math.abs(this.squashY - 1) > 0.01;
    if (needsTransform) {
      renderer.save();
      renderer.translate(x, y);
      renderer.scale(this.squashX, this.squashY);
      renderer.translate(-x, -y);
    }

    // Lower opacity while invulnerable to telegraph i-frames.
    const iframes = this.iframeTimer > 0;
    if (iframes) renderer.setAlpha(0.55);

    // Flash white on damage
    if (this.flashTimer > 0) {
      const flashPalette = {};
      for (const key in SPRITE_PALETTE) {
        flashPalette[key] = '#fff';
      }
      renderer.pixelSprite(x, y, drawSprite, flashPalette, 2);
    } else {
      renderer.pixelSprite(x, y, drawSprite, SPRITE_PALETTE, 2);
    }

    if (iframes) renderer.resetAlpha();

    if (needsTransform) {
      renderer.restore();
    }

    // Draw health bar above player if damaged
    if (this.hp < this.maxHp) {
      const barW = 24;
      const barH = 3;
      renderer.healthBar(
        x - barW / 2,
        y - 16,
        barW, barH,
        this.hp / this.maxHp,
        CONST.COLOR_HP_BAR,
        CONST.COLOR_HP_BG
      );
    }
  }

  // Turn the player to face the given direction vector. Zero-length vectors
  // are ignored so facing never degenerates to NaN.
  face(dx, dy) {
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0.0001) {
      this.facing = new Vec2(dx / len, dy / len);
    }
  }

  takeDamage(amount) {
    if (!this.alive) return;
    // Dash i-frames: completely ignore incoming damage.
    if (this.iframeTimer > 0) return;
    this.hp -= amount;
    // Squash on hit
    this.squashX = 0.7;
    this.squashY = 1.3;
    // Reset regen accumulator so progress toward the next HP tick doesn't
    // carry over through damage.
    this.regenAccum = 0;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  addGold(amount) {
    this.gold += amount;
  }

  reset(x, y) {
    this.pos.set(x, y);
    this.vel.set(0, 0);
    this.hp = this.maxHp;
    this.alive = true;
    this.attackTimer = 0;
    this.regenAccum = 0;
    this.dashTimer = 0;
    this.dashCooldownTimer = 0;
    this.iframeTimer = 0;
    this.anim = Anim.IDLE;
    this.animTimer = 0;
    this.animFrame = 0;
  }

  // Move the player to a new spot between waves without touching HP, stats,
  // or upgrades. Clears motion / dash state so the spawn is clean.
  respawnAt(x, y) {
    this.pos.set(x, y);
    this.vel.set(0, 0);
    this.attackTimer = 0;
    this.dashTimer = 0;
    this.dashCooldownTimer = 0;
    this.iframeTimer = 0;
    this.anim = Anim.IDLE;
    this.animTimer = 0;
    this.animFrame = 0;
    this.isAttacking = false;
    this.attackAnimTimer = 0;
    this.squashX = 1;
    this.squashY = 1;
  }
}
