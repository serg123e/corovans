// Caravan - caravans, guards, and wave spawning

import { Vec2, CONST, clamp } from './utils.js';
import { randFn } from './rng.js';

// Caravan types
export const CaravanType = {
  DONKEY: 'donkey',
  WAGON: 'wagon',
  ROYAL: 'royal',
};

const CARAVAN_DEFS = {
  [CaravanType.DONKEY]: {
    speed: CONST.DONKEY_SPEED,
    radius: 14,
    lootMin: 10,
    lootMax: 25,
    guardCount: 1,
    hp: 30,
    label: 'Осёл',
  },
  [CaravanType.WAGON]: {
    speed: CONST.WAGON_SPEED,
    radius: 18,
    lootMin: 30,
    lootMax: 60,
    guardCount: 2,
    hp: 60,
    label: 'Телега',
  },
  [CaravanType.ROYAL]: {
    speed: CONST.ROYAL_SPEED,
    radius: 22,
    lootMin: 80,
    lootMax: 150,
    guardCount: 3,
    hp: 100,
    label: 'Карета',
  },
};

// Guard types
export const GuardType = {
  BASIC: 'basic',
  ARMORED: 'armored',
  ARCHER: 'archer',
};

// Guard AI states
const GuardState = {
  PATROL: 'patrol',
  CHASE: 'chase',
  RETURN: 'return',
};

// Pixel-art sprites

const GUARD_PALETTE = {
  'H': '#34495e', // helmet
  'h': '#2c3e50', // helmet dark
  'F': '#d4a574', // face
  'E': '#1a1a1a', // eyes
  'A': '#7f8c8d', // armor
  'a': '#636e72', // armor dark
  'P': '#4a4a5a', // pants
  'p': '#3a3a4a', // pants dark
  'S': '#5a4a3a', // shoes
  'W': '#bdc3c7', // weapon (sword)
};

const GUARD_SPRITE = [
  ' .HHH. ',
  ' hhhhh ',
  ' .FEF. ',
  ' AAAAA ',
  ' aAAAa ',
  ' .AAA. ',
  ' .PPP. ',
  ' pP.Pp ',
  ' SS.SS ',
];

const GUARD_WALK_1 = [
  ' .HHH. ',
  ' hhhhh ',
  ' .FEF. ',
  'WAAAAA ',
  ' aAAAa ',
  ' .AAA. ',
  ' .PPP. ',
  ' pP..P ',
  ' SS..S ',
];

const GUARD_WALK_2 = [
  ' .HHH. ',
  ' hhhhh ',
  ' .FEF. ',
  ' AAAAAW',
  ' aAAAa ',
  ' .AAA. ',
  ' .PPP. ',
  ' P..Pp ',
  ' S..SS ',
];

// Armored guard sprites
const ARMORED_PALETTE = {
  'H': '#5a5a6a', // heavy helmet
  'h': '#4a4a5a', // helmet dark
  'F': '#d4a574', // face
  'E': '#1a1a1a', // eyes
  'A': '#6a6a7a', // heavy armor
  'a': '#5a5a6a', // armor dark
  'P': '#4a4a5a', // pants
  'p': '#3a3a4a', // pants dark
  'S': '#5a4a3a', // shoes
  'W': '#8a8a9a', // shield
};

const ARMORED_SPRITE = [
  ' .HHH. ',
  ' hhHhh ',
  ' .FEF. ',
  'WAAAAAW',
  'WaAAAaW',
  ' .AAA. ',
  ' .PPP. ',
  ' pP.Pp ',
  ' SS.SS ',
];

const ARMORED_WALK_1 = [
  ' .HHH. ',
  ' hhHhh ',
  ' .FEF. ',
  'WAAAAAW',
  'WaAAAaW',
  ' .AAA. ',
  ' .PPP. ',
  ' pP..P ',
  ' SS..S ',
];

const ARMORED_WALK_2 = [
  ' .HHH. ',
  ' hhHhh ',
  ' .FEF. ',
  'WAAAAAW',
  'WaAAAaW',
  ' .AAA. ',
  ' .PPP. ',
  ' P..Pp ',
  ' S..SS ',
];

// Archer guard sprites
const ARCHER_PALETTE = {
  'H': '#2e4a1e', // hood
  'h': '#1e3a0e', // hood dark
  'F': '#d4a574', // face
  'E': '#1a1a1a', // eyes
  'A': '#4a6a3a', // tunic
  'a': '#3a5a2a', // tunic dark
  'P': '#5a4a3a', // pants
  'p': '#4a3a2a', // pants dark
  'S': '#5a4a3a', // shoes
  'B': '#6a4a2a', // bow
};

const ARCHER_SPRITE = [
  ' .HHH. ',
  ' hhhhh ',
  ' .FEF. ',
  ' AAAAA ',
  ' aAAAaB',
  ' .AAA.B',
  ' .PPP. ',
  ' pP.Pp ',
  ' SS.SS ',
];

const ARCHER_WALK_1 = [
  ' .HHH. ',
  ' hhhhh ',
  ' .FEF. ',
  ' AAAAA ',
  ' aAAAaB',
  ' .AAA.B',
  ' .PPP. ',
  ' pP..P ',
  ' SS..S ',
];

const ARCHER_WALK_2 = [
  ' .HHH. ',
  ' hhhhh ',
  ' .FEF. ',
  ' AAAAA ',
  ' aAAAaB',
  ' .AAA.B',
  ' .PPP. ',
  ' P..Pp ',
  ' S..SS ',
];

// Caravan sprites - viewed from the side
const DONKEY_PALETTE = {
  'B': '#8B7355', // body
  'b': '#6B5335', // body dark
  'H': '#7B6345', // head
  'E': '#1a1a1a', // eye
  'L': '#5a4a3a', // legs
  'T': '#4a3a2a', // tail
  'S': '#a08060', // saddle/pack
  's': '#806040', // saddle dark
};

const DONKEY_SPRITE = [
  ' ..SS.. ',
  ' .SssS. ',
  'H.BBBB.',
  'HE.BBB.',
  '..bBBb..',
  '..L..L..',
  '..L..L..',
];

const WAGON_PALETTE = {
  'W': '#8B6914', // wood
  'w': '#6B4914', // wood dark
  'C': '#a08050', // canvas top
  'c': '#806030', // canvas dark
  'R': '#4a3a2a', // wheels
  'r': '#3a2a1a', // wheel dark
  'A': '#5a4a3a', // axle
};

const WAGON_SPRITE = [
  ' .CCC. ',
  ' cCCCc ',
  ' CCCCC ',
  ' WWWWW ',
  ' wWWWw ',
  'R.AAA.R',
  'rR...Rr',
];

const ROYAL_PALETTE = {
  'G': '#ffd700', // gold trim
  'R': '#8b0000', // royal red
  'r': '#6b0000', // royal dark
  'W': '#f0e0c0', // white
  'w': '#d0c0a0', // white dark
  'D': '#4a3a2a', // wheels
  'd': '#3a2a1a', // wheel dark
  'A': '#5a4a3a', // axle
  'C': '#c0a040', // crown ornament
};

const ROYAL_SPRITE = [
  ' ..C.. ',
  ' .GGG. ',
  ' GRRG. ',
  ' RRRRR ',
  ' rRWRr ',
  ' WWWWW ',
  'D.AAA.D',
  'dD...Dd',
];


export class Guard {
  constructor(x, y, caravan, type = GuardType.BASIC, rng = null) {
    this.pos = new Vec2(x, y);
    this.vel = new Vec2(0, 0);
    this.radius = CONST.GUARD_RADIUS;
    this.caravan = caravan;
    this.type = type;

    // Stats based on guard type
    this.armor = 0;
    switch (type) {
      case GuardType.ARMORED:
        this.maxHp = CONST.ARMORED_GUARD_HP;
        this.damage = CONST.ARMORED_GUARD_DAMAGE;
        this.speed = CONST.ARMORED_GUARD_SPEED;
        this.detectionRange = CONST.ARMORED_GUARD_DETECTION_RANGE;
        this.attackRange = CONST.GUARD_ATTACK_RANGE;
        this.attackCooldown = CONST.GUARD_ATTACK_COOLDOWN;
        this.armor = CONST.ARMORED_GUARD_ARMOR;
        break;
      case GuardType.ARCHER:
        this.maxHp = CONST.ARCHER_GUARD_HP;
        this.damage = CONST.ARCHER_GUARD_DAMAGE;
        this.speed = CONST.ARCHER_GUARD_SPEED;
        this.detectionRange = CONST.ARCHER_GUARD_DETECTION_RANGE;
        this.attackRange = CONST.ARCHER_GUARD_ATTACK_RANGE;
        this.attackCooldown = CONST.ARCHER_GUARD_ATTACK_COOLDOWN;
        break;
      default: // BASIC
        this.maxHp = CONST.GUARD_BASE_HP;
        this.damage = CONST.GUARD_BASE_DAMAGE;
        this.speed = CONST.GUARD_SPEED;
        this.detectionRange = CONST.GUARD_DETECTION_RANGE;
        this.attackRange = CONST.GUARD_ATTACK_RANGE;
        this.attackCooldown = CONST.GUARD_ATTACK_COOLDOWN;
        break;
    }

    this.hp = this.maxHp;
    this.chaseRange = CONST.GUARD_CHASE_RANGE;
    this.attackTimer = 0;

    // AI
    this.state = GuardState.PATROL;
    const rand = randFn(rng);
    this.patrolOffset = new Vec2(
      (rand() - 0.5) * 40,
      (rand() - 0.5) * 40
    );
    this.alive = true;

    // Visual juice
    this.flashTimer = 0;

    // Animation - set sprites based on type
    this.animTimer = 0;
    this.animFrame = 0;
    this.facing = new Vec2(1, 0);

    switch (type) {
      case GuardType.ARMORED:
        this.walkFrames = [ARMORED_WALK_1, ARMORED_WALK_2];
        this.idleSprite = ARMORED_SPRITE;
        this.palette = ARMORED_PALETTE;
        break;
      case GuardType.ARCHER:
        this.walkFrames = [ARCHER_WALK_1, ARCHER_WALK_2];
        this.idleSprite = ARCHER_SPRITE;
        this.palette = ARCHER_PALETTE;
        break;
      default:
        this.walkFrames = [GUARD_WALK_1, GUARD_WALK_2];
        this.idleSprite = GUARD_SPRITE;
        this.palette = GUARD_PALETTE;
        break;
    }
  }

  update(dt, playerPos) {
    if (!this.alive) return;

    // Flash timer
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
    }

    // Attack cooldown
    if (this.attackTimer > 0) {
      this.attackTimer -= dt;
    }

    const distToPlayer = this.pos.dist(playerPos);
    const caravanPos = this.caravan.alive ? this.caravan.pos : this.pos;
    const distToCaravan = this.pos.dist(caravanPos);

    // State transitions. Once the caravan is gone, guards no longer have
    // anything to protect: lock them into CHASE so they keep pursuing the
    // player instead of drifting back to their (now absent) charge.
    if (!this.caravan.alive) {
      this.state = GuardState.CHASE;
    } else {
      switch (this.state) {
        case GuardState.PATROL:
          if (distToPlayer < this.detectionRange) {
            this.state = GuardState.CHASE;
          }
          break;
        case GuardState.CHASE:
          if (distToPlayer > this.chaseRange || distToCaravan > this.chaseRange * 1.5) {
            this.state = GuardState.RETURN;
          }
          break;
        case GuardState.RETURN:
          if (distToPlayer < this.detectionRange * 0.8) {
            this.state = GuardState.CHASE;
          } else if (distToCaravan < 30) {
            this.state = GuardState.PATROL;
          }
          break;
      }
    }

    // Movement based on state
    let targetPos;
    switch (this.state) {
      case GuardState.PATROL:
        targetPos = caravanPos.add(this.patrolOffset);
        break;
      case GuardState.CHASE:
        if (this.type === GuardType.ARCHER) {
          // Archers try to maintain preferred distance
          const toPlayer = playerPos.sub(this.pos);
          const dist = toPlayer.len();
          if (dist < CONST.ARCHER_PREFERRED_DIST * 0.7) {
            // Too close - back away
            targetPos = this.pos.sub(toPlayer.normalize().mul(CONST.ARCHER_PREFERRED_DIST));
          } else if (dist > CONST.ARCHER_PREFERRED_DIST * 1.3) {
            // Too far - approach
            targetPos = playerPos;
          } else {
            // Good range - strafe slightly
            targetPos = this.pos;
          }
        } else {
          // Melee guards stop just outside the player's body so they don't
          // occlude the sprite by sharing the same tile. Standoff stays inside
          // attack reach (radius + attackRange), so attacks still land.
          const toPlayer = playerPos.sub(this.pos);
          const dist = toPlayer.len();
          const standoff = this.radius + CONST.PLAYER_RADIUS + 4;
          if (dist > standoff) {
            const dir = toPlayer.normalize();
            targetPos = playerPos.sub(dir.mul(standoff));
          } else {
            // Already at the ring - hold position.
            targetPos = this.pos;
          }
        }
        break;
      case GuardState.RETURN:
        targetPos = caravanPos;
        break;
    }

    const toTarget = targetPos.sub(this.pos);
    const distToTarget = toTarget.len();

    if (distToTarget > 3) {
      const dir = toTarget.normalize();
      this.vel = dir.mul(this.speed);
      this.facing = dir;
    } else {
      this.vel = new Vec2(0, 0);
    }

    // Archers always face the player when chasing
    if (this.type === GuardType.ARCHER && this.state === GuardState.CHASE) {
      this.facing = playerPos.sub(this.pos).normalize();
    }

    this.pos = this.pos.add(this.vel.mul(dt));

    // Animation
    this.animTimer += dt;
    if (this.vel.lenSq() > 10) {
      this.animFrame = Math.floor(this.animTimer / 0.2) % this.walkFrames.length;
    } else {
      this.animFrame = -1; // idle
    }
  }

  canAttack(playerPos) {
    if (!this.alive || this.attackTimer > 0) return false;
    const dist = this.pos.dist(playerPos);
    if (this.type === GuardType.ARCHER) {
      return dist < this.attackRange && this.state === GuardState.CHASE;
    }
    return dist < this.attackRange + CONST.PLAYER_RADIUS;
  }

  attack(playerPos) {
    this.attackTimer = this.attackCooldown;
    if (this.type === GuardType.ARCHER) {
      // Return projectile info instead of direct damage
      const dir = playerPos.sub(this.pos).normalize();
      return { ranged: true, damage: this.damage, origin: this.pos.copy(), dir };
    }
    return { ranged: false, damage: this.damage };
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  render(renderer) {
    if (!this.alive) return;

    const flipH = this.facing.x < -0.1;
    let sprite;
    if (this.animFrame >= 0) {
      sprite = this.walkFrames[this.animFrame];
    } else {
      sprite = this.idleSprite;
    }

    const drawSprite = flipH ? sprite.map(row => row.split('').reverse().join('')) : sprite;

    // Flash white on damage
    if (this.flashTimer > 0) {
      const flashPalette = {};
      for (const key in this.palette) {
        flashPalette[key] = '#fff';
      }
      renderer.pixelSprite(this.pos.x, this.pos.y, drawSprite, flashPalette, 2);
    } else {
      renderer.pixelSprite(this.pos.x, this.pos.y, drawSprite, this.palette, 2);
    }

    // Health bar when damaged
    if (this.hp < this.maxHp) {
      const barW = 20;
      const barH = 3;
      const barColor = this.type === GuardType.ARMORED ? '#3498db' :
                        this.type === GuardType.ARCHER ? '#2ecc71' : '#e67e22';
      renderer.healthBar(
        this.pos.x - barW / 2,
        this.pos.y - 14,
        barW, barH,
        this.hp / this.maxHp,
        barColor,
        CONST.COLOR_HP_BG
      );
    }
  }
}


export class Caravan {
  constructor(type, world, rng = null) {
    const def = CARAVAN_DEFS[type];
    this.type = type;
    this.def = def;
    this.world = world;
    this.radius = def.radius;

    // Path following
    this.pathT = 0; // 0 to 1 along the road
    this.speed = def.speed;
    this.direction = 1; // 1 = forward, -1 = reverse (for variety)

    // Position from path
    const startPos = world.getRoadPosition(this.pathT);
    this.pos = new Vec2(startPos.x, startPos.y);

    // Health
    this.maxHp = def.hp;
    this.hp = this.maxHp;
    this.alive = true;

    // Loot (seeded when called from the sim so runs reproduce exactly)
    const rand = randFn(rng);
    this.lootValue = Math.floor(def.lootMin + rand() * (def.lootMax - def.lootMin + 1));

    // Guards
    this.guards = [];

    // State
    this.looted = false; // has been destroyed and loot dropped
    this.escaped = false; // reached end of road without being robbed
    this.isBoss = false; // set to true for boss caravans

    // Visual juice
    this.flashTimer = 0;
  }

  spawnGuards(wave = 1, rng = null) {
    // Extra guards from wave scaling: +1 guard per 3 waves
    const extraGuards = Math.floor(wave / 3);
    const count = this.def.guardCount + extraGuards;
    const rand = randFn(rng);

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const offset = 30;
      const gx = this.pos.x + Math.cos(angle) * offset;
      const gy = this.pos.y + Math.sin(angle) * offset;

      // Choose guard type based on wave
      // Armored from wave 4+, archers from wave 7+ (wave 6 already ramps
      // caravan count + armored density; adding archers on top stalls runs).
      let guardType = GuardType.BASIC;
      if (wave >= 4) {
        const roll = rand();
        if (roll < 0.35) {
          guardType = GuardType.ARMORED;
        } else if (wave >= 7 && roll < 0.60) {
          guardType = GuardType.ARCHER;
        }
      }

      const guard = new Guard(gx, gy, this, guardType, rng);
      this.guards.push(guard);
    }
    return this.guards;
  }

  update(dt, playerPos) {
    if (!this.alive) return;

    if (this.flashTimer > 0) this.flashTimer -= dt;

    // Advance along road
    // Convert speed to path parameter change
    // Road length is roughly world width, so speed / worldWidth gives approximate dt for pathT
    const roadLen = this.world.width * 1.2; // approximate road length (a bit longer than world width due to curves)
    const pathSpeed = this.speed / roadLen;
    this.pathT += pathSpeed * dt * this.direction;

    // If reached end, caravan escapes
    if (this.pathT > 1 || this.pathT < 0) {
      this.alive = false;
      this.looted = true; // mark as done (escaped, no loot)
      this.escaped = true;
      return;
    }

    // Update position from path
    const roadPos = this.world.getRoadPosition(this.pathT);
    this.pos.x = roadPos.x;
    this.pos.y = roadPos.y;
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  render(renderer) {
    if (!this.alive) return;

    let sprite, palette;
    switch (this.type) {
      case CaravanType.DONKEY:
        sprite = DONKEY_SPRITE;
        palette = DONKEY_PALETTE;
        break;
      case CaravanType.WAGON:
        sprite = WAGON_SPRITE;
        palette = WAGON_PALETTE;
        break;
      case CaravanType.ROYAL:
        sprite = ROYAL_SPRITE;
        palette = ROYAL_PALETTE;
        break;
    }

    // Flip based on direction
    const flipH = this.direction < 0;
    const drawSprite = flipH ? sprite.map(row => row.split('').reverse().join('')) : sprite;
    const spriteScale = this.isBoss ? 3 : 2;

    // Flash white on damage
    if (this.flashTimer > 0) {
      const flashPalette = {};
      for (const key in palette) {
        flashPalette[key] = '#fff';
      }
      renderer.pixelSprite(this.pos.x, this.pos.y, drawSprite, flashPalette, spriteScale);
    } else {
      renderer.pixelSprite(this.pos.x, this.pos.y, drawSprite, palette, spriteScale);
    }

    // Boss indicator
    if (this.isBoss) {
      renderer.circle(this.pos.x, this.pos.y - this.radius - 12, 5, '#ffd700');
      renderer.circle(this.pos.x, this.pos.y - this.radius - 12, 3, '#ffee44');
    }

    // Health bar when damaged
    if (this.hp < this.maxHp) {
      const barW = this.isBoss ? 50 : 30;
      const barH = this.isBoss ? 5 : 4;
      renderer.healthBar(
        this.pos.x - barW / 2,
        this.pos.y - this.radius - 6,
        barW, barH,
        this.hp / this.maxHp,
        this.isBoss ? '#ff4444' : '#e74c3c',
        CONST.COLOR_HP_BG
      );
    }
  }
}


// Push overlapping guards apart and out of their caravans. Runs after the
// guard AI has moved everyone for the frame. Single pass is enough for the
// cluster sizes we deal with (a few guards per caravan).
export function resolveGuardCollisions(guards, caravans) {
  // Guard vs guard
  for (let i = 0; i < guards.length; i++) {
    const a = guards[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < guards.length; j++) {
      const b = guards[j];
      if (!b.alive) continue;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const distSq = dx * dx + dy * dy;
      const minDist = a.radius + b.radius;
      if (distSq >= minDist * minDist) continue;
      if (distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const push = (minDist - dist) / 2;
        const nx = dx / dist;
        const ny = dy / dist;
        a.pos.x -= nx * push;
        a.pos.y -= ny * push;
        b.pos.x += nx * push;
        b.pos.y += ny * push;
      } else {
        // Exact overlap — nudge one arbitrarily so the next pass can resolve.
        b.pos.x += minDist;
      }
    }
  }

  // Guard vs caravan — the caravan follows its road, so only the guard moves.
  for (const c of caravans) {
    if (!c.alive) continue;
    for (const g of guards) {
      if (!g.alive) continue;
      const dx = g.pos.x - c.pos.x;
      const dy = g.pos.y - c.pos.y;
      const distSq = dx * dx + dy * dy;
      const minDist = g.radius + c.radius;
      if (distSq >= minDist * minDist) continue;
      if (distSq > 0.0001) {
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        g.pos.x += (dx / dist) * overlap;
        g.pos.y += (dy / dist) * overlap;
      } else {
        g.pos.x += minDist;
      }
    }
  }
}

// Wave spawning system
export function spawnWave(wave, world, rng = null) {
  const caravans = [];
  const isBossWave = wave > 0 && wave % 5 === 0;
  const rand = randFn(rng);

  // Scaling: more caravans as waves progress
  // Wave 1: 1, Wave 2: 1, Wave 3: 2, Wave 4: 2, Wave 5 (boss): 1 boss + 1 normal, etc.
  let caravanCount = Math.min(1 + Math.floor(wave / 2), 6);

  if (isBossWave) {
    // Boss wave: spawn one boss caravan + fewer regular caravans
    const bossCaravan = new Caravan(CaravanType.ROYAL, world, rng);
    bossCaravan.isBoss = true;
    bossCaravan.maxHp = Math.round(bossCaravan.maxHp * CONST.BOSS_HP_MULTIPLIER);
    bossCaravan.hp = bossCaravan.maxHp;
    bossCaravan.lootValue = Math.round(bossCaravan.lootValue * CONST.BOSS_LOOT_MULTIPLIER);
    bossCaravan.radius = 28; // bigger sprite

    // Override guard count for boss caravan
    bossCaravan.def = { ...bossCaravan.def, guardCount: CONST.BOSS_GUARD_COUNT };
    bossCaravan.pathT = 0.02;
    bossCaravan.direction = 1;
    const roadPos = world.getRoadPosition(bossCaravan.pathT);
    bossCaravan.pos.x = roadPos.x;
    bossCaravan.pos.y = roadPos.y;
    caravans.push(bossCaravan);

    // Fewer regular caravans on boss waves
    caravanCount = Math.max(1, Math.floor(caravanCount / 2));
  }

  const startIdx = caravans.length;
  for (let i = 0; i < caravanCount; i++) {
    // Choose type based on wave
    let type;
    if (wave <= 2) {
      type = CaravanType.DONKEY;
    } else if (wave <= 4) {
      type = rand() < 0.6 ? CaravanType.DONKEY : CaravanType.WAGON;
    } else {
      const roll = rand();
      if (roll < 0.3) type = CaravanType.DONKEY;
      else if (roll < 0.7) type = CaravanType.WAGON;
      else type = CaravanType.ROYAL;
    }

    const caravan = new Caravan(type, world, rng);

    // Stagger starting positions along the road
    caravan.pathT = 0.02 + ((startIdx + i) * 0.12);
    caravan.direction = 1;
    const roadPos = world.getRoadPosition(caravan.pathT);
    caravan.pos.x = roadPos.x;
    caravan.pos.y = roadPos.y;

    caravans.push(caravan);
  }

  return caravans;
}
