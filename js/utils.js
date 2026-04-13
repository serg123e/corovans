// Vec2 - 2D vector math

export class Vec2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  copy() {
    return new Vec2(this.x, this.y);
  }

  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }

  add(v) {
    return new Vec2(this.x + v.x, this.y + v.y);
  }

  sub(v) {
    return new Vec2(this.x - v.x, this.y - v.y);
  }

  mul(s) {
    return new Vec2(this.x * s, this.y * s);
  }

  div(s) {
    return new Vec2(this.x / s, this.y / s);
  }

  dot(v) {
    return this.x * v.x + this.y * v.y;
  }

  len() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  lenSq() {
    return this.x * this.x + this.y * this.y;
  }

  normalize() {
    const l = this.len();
    if (l === 0) return new Vec2(0, 0);
    return this.div(l);
  }

  dist(v) {
    return this.sub(v).len();
  }

  distSq(v) {
    return this.sub(v).lenSq();
  }

  angle() {
    return Math.atan2(this.y, this.x);
  }

  rotate(angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return new Vec2(
      this.x * cos - this.y * sin,
      this.x * sin + this.y * cos
    );
  }

  lerp(v, t) {
    return new Vec2(
      this.x + (v.x - this.x) * t,
      this.y + (v.y - this.y) * t
    );
  }

  clampLen(maxLen) {
    const l = this.len();
    if (l > maxLen) return this.normalize().mul(maxLen);
    return this.copy();
  }

  equals(v) {
    return Math.abs(this.x - v.x) < 0.0001 && Math.abs(this.y - v.y) < 0.0001;
  }

  static fromAngle(angle) {
    return new Vec2(Math.cos(angle), Math.sin(angle));
  }
}

// Collision utilities

export function circlesOverlap(ax, ay, ar, bx, by, br) {
  const dx = ax - bx;
  const dy = ay - by;
  const distSq = dx * dx + dy * dy;
  const radSum = ar + br;
  return distSq < radSum * radSum;
}

export function pointInRect(px, py, rx, ry, rw, rh) {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

export function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function pointInCircle(px, py, cx, cy, cr) {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy < cr * cr;
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function randRange(min, max) {
  return min + Math.random() * (max - min);
}

export function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}

export function choose(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Seeded random for reproducible terrain
export function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// Game constants

export const CONST = {
  // World
  WORLD_W: 2400,
  WORLD_H: 1600,
  TILE_SIZE: 32,

  // Player
  PLAYER_SPEED: 95,
  PLAYER_ACCEL: 800,
  PLAYER_FRICTION: 6,
  PLAYER_RADIUS: 12,
  PLAYER_MAX_HP: 100,
  PLAYER_BASE_DAMAGE: 15,
  PLAYER_ATTACK_RANGE: 28,
  PLAYER_ATTACK_COOLDOWN: 0.4,
  PLAYER_HP_REGEN_PER_SEC: 2,
  PLAYER_DASH_SPEED: 460,
  PLAYER_DASH_DURATION: 0.18,
  PLAYER_DASH_COOLDOWN: 1.0,
  PLAYER_DASH_IFRAME_DURATION: 0.22,

  // Guards - basic (sword)
  GUARD_SPEED: 80,
  GUARD_DETECTION_RANGE: 120,
  GUARD_CHASE_RANGE: 200,
  GUARD_ATTACK_RANGE: 20,
  GUARD_ATTACK_COOLDOWN: 0.8,
  GUARD_RADIUS: 10,
  GUARD_BASE_HP: 40,
  GUARD_BASE_DAMAGE: 8,

  // Guards - armored
  ARMORED_GUARD_SPEED: 55,
  ARMORED_GUARD_HP: 90,
  ARMORED_GUARD_DAMAGE: 12,
  ARMORED_GUARD_DETECTION_RANGE: 100,
  ARMORED_GUARD_ARMOR: 30,

  // Guards - archer
  ARCHER_GUARD_SPEED: 65,
  ARCHER_GUARD_HP: 30,
  ARCHER_GUARD_DAMAGE: 6,
  ARCHER_GUARD_DETECTION_RANGE: 180,
  ARCHER_GUARD_ATTACK_RANGE: 150,
  ARCHER_GUARD_ATTACK_COOLDOWN: 1.5,
  ARCHER_PREFERRED_DIST: 100,

  // Projectiles
  PROJECTILE_SPEED: 200,
  PROJECTILE_RADIUS: 4,
  PROJECTILE_LIFETIME: 3,

  // Boss
  BOSS_HP_MULTIPLIER: 3,
  BOSS_LOOT_MULTIPLIER: 3,
  BOSS_GUARD_COUNT: 5,

  // Scoring
  FLAWLESS_WAVE_BONUS: 50,

  // Caravans
  CARAVAN_RADIUS: 18,
  DONKEY_SPEED: 40,
  WAGON_SPEED: 30,
  ROYAL_SPEED: 20,

  // Loot
  LOOT_RADIUS: 6,
  LOOT_MAGNET_RANGE: 40,
  LOOT_MAGNET_SPEED: 200,

  // UI
  HUD_HEIGHT: 40,

  // Colors
  COLOR_SAND: '#e8c872',
  COLOR_SAND_DARK: '#d4b45c',
  COLOR_SAND_LIGHT: '#f0d888',
  COLOR_ROAD: '#c4a24e',
  COLOR_ROAD_EDGE: '#b0903a',
  COLOR_BUSH: '#6b8e3a',
  COLOR_ROCK: '#8a8278',
  COLOR_GOLD: '#ffd700',
  COLOR_HP_BAR: '#e74c3c',
  COLOR_HP_BG: '#333',
  COLOR_PLAYER: '#c0392b',
  COLOR_GUARD: '#2c3e50',
  COLOR_CARAVAN: '#8b6914',
};
